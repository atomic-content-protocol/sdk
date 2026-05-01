import { ValidationError, FetchError } from "./errors.js";

const DEFAULT_MAX_CHARS = 100_000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "ACP-SDK/0.1";

export interface FetchBodyOptions {
  maxChars?: number;
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new ValidationError(
      `Only HTTPS URLs are allowed, got: ${parsed.protocol}`
    );
  }

  // The WHATWG URL API serialises IPv6 hosts with brackets in .hostname (e.g. "[::1]").
  // Strip them so bare-address comparisons work consistently.
  const rawHost = parsed.hostname.toLowerCase();
  const host =
    rawHost.startsWith("[") && rawHost.endsWith("]")
      ? rawHost.slice(1, -1)
      : rawHost;

  const BLOCKED = ["localhost", "127.0.0.1", "::1", "metadata.google.internal"];
  if (BLOCKED.includes(host)) {
    throw new ValidationError(`Blocked host: ${host}`);
  }
  if (/^169\.254\./.test(host)) {
    throw new ValidationError(`Blocked link-local address: ${host}`);
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ValidationError(`Blocked internal host: ${host}`);
  }
}

// ---------------------------------------------------------------------------
// HTML content extraction
// ---------------------------------------------------------------------------

function extractText(html: string): string {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

  // Prefer semantic content zones: article > main > body
  const zone =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(stripped)?.[1] ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(stripped)?.[1] ??
    /<body[^>]*>([\s\S]*?)<\/body>/i.exec(stripped)?.[1] ??
    stripped;

  return zone
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// SPA / empty-body fallback: synthesise signal from meta tags so the LLM
// enrichment step still has something to work with.
function spaFallback(html: string, url: string): string {
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  const ogTitle =
    /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i.exec(html)?.[1] ??
    /<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i.exec(html)?.[1];
  const metaDesc =
    /<meta[^>]*name="description"[^>]*content="([^"]+)"/i.exec(html)?.[1] ??
    /<meta[^>]*content="([^"]+)"[^>]*name="description"/i.exec(html)?.[1];

  return [ogTitle ?? title, metaDesc, url].filter(Boolean).join(" — ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * fetchBodyForUrl — fetch a URL and extract its main text content.
 *
 * Throws `ValidationError` for SSRF-unsafe URLs (non-HTTPS, localhost, etc.).
 * Throws `FetchError` for network errors and HTTP 4xx/5xx responses, with
 * `permanent` set to indicate whether the caller should retry.
 *
 * Power users who want to pre-fetch and still call `createACO({ body })` can
 * call this function directly.
 */
export async function fetchBodyForUrl(
  url: string,
  options?: FetchBodyOptions
): Promise<string> {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  validateUrl(url);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: unknown) {
    // AbortSignal.timeout throws DOMException (no .code) → permanent: false (transient)
    const code = (err as NodeJS.ErrnoException).code ?? "";
    const permanentCodes = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);
    const permanent = permanentCodes.has(code);
    throw new FetchError(
      `Network error fetching ${url}: ${(err as Error).message}`,
      permanent,
      { cause: err }
    );
  }

  if (!response.ok) {
    const permanent = response.status >= 400 && response.status < 500;
    throw new FetchError(`HTTP ${response.status} fetching ${url}`, permanent);
  }

  const html = await response.text();
  let text = extractText(html);
  if (!text) {
    text = spaFallback(html, url);
  }

  return text.slice(0, maxChars);
}
