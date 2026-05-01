import { ValidationError, FetchError } from "./errors.js";

const DEFAULT_MAX_CHARS = 100_000;
const MAX_RESPONSE_BYTES = 10_000_000; // 10 MB hard cap before reading into memory
const TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT = "ACP-SDK/0.1";

// Hoisted to module scope — not recreated on every call.
const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "metadata.google.internal",
]);
const PERMANENT_NETWORK_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);

export interface FetchBodyOptions {
  maxChars?: number;
  /** Override the User-Agent header sent with the request. */
  userAgent?: string;
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

  if (BLOCKED_HOSTS.has(host)) {
    throw new ValidationError(`Blocked host: ${host}`);
  }

  // RFC 1918 private ranges + link-local (169.254.x.x)
  if (
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new ValidationError(`Blocked private/link-local address: ${host}`);
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

// Extract a <meta> tag's content attribute, supporting both single and double
// quotes and either attribute order (attrName=val content=X or content=X attrName=val).
function metaContent(html: string, attr: string, value: string): string | undefined {
  const q = `["']`;
  const val = `([^"'<>]+)`;
  return (
    new RegExp(`<meta[^>]*${attr}=${q}${value}${q}[^>]*content=${q}${val}${q}`, "i").exec(html)?.[1] ??
    new RegExp(`<meta[^>]*content=${q}${val}${q}[^>]*${attr}=${q}${value}${q}`, "i").exec(html)?.[1]
  );
}

// SPA / empty-body fallback: synthesise signal from meta tags so the LLM
// enrichment step still has something to work with.
function spaFallback(html: string, url: string): string {
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  const ogTitle = metaContent(html, "property", "og:title");
  const metaDesc = metaContent(html, "name", "description");

  return [ogTitle ?? title, metaDesc, url].filter(Boolean).join(" — ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * fetchBodyForUrl — fetch a URL and extract its main text content.
 *
 * Throws `ValidationError` for SSRF-unsafe URLs (non-HTTPS, private IPs, etc.).
 * Throws `FetchError` for network errors, HTTP 4xx/5xx, oversized/non-HTML
 * responses, and body-read failures. `FetchError.permanent` indicates whether
 * the caller should retry; `FetchError.networkCode` gives the machine-readable
 * failure reason (e.g. "ENOTFOUND", "HTTP_404", "NON_HTML_CONTENT").
 *
 * HTTP redirects are refused (`redirect: "error"`) to prevent SSRF via open
 * redirectors. Node.js ≥ 20 is required (enforced in package.json engines).
 */
export async function fetchBodyForUrl(
  url: string,
  options?: FetchBodyOptions
): Promise<string> {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;

  validateUrl(url);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": userAgent },
      // Never follow redirects — a public URL can redirect to a private IP,
      // bypassing the SSRF guard that only validates the initial hostname.
      redirect: "error",
      // AbortSignal.timeout requires Node ≥ 17.3; engines field enforces ≥ 20.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    const permanent = PERMANENT_NETWORK_CODES.has(code);
    throw new FetchError(
      `Network error fetching ${url}: ${(err as Error).message}`,
      permanent,
      code || undefined,
      { cause: err }
    );
  }

  if (!response.ok) {
    const permanent = response.status >= 400 && response.status < 500;
    throw new FetchError(
      `HTTP ${response.status} fetching ${url}`,
      permanent,
      `HTTP_${response.status}`
    );
  }

  // Refuse unexpectedly large responses before loading into memory.
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
    throw new FetchError(
      `Response too large from ${url} (Content-Length: ${contentLength})`,
      false,
      "RESPONSE_TOO_LARGE"
    );
  }

  // Refuse non-HTML content types (missing header = allow, to handle servers
  // that omit it on valid HTML responses).
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType !== "" &&
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new FetchError(
      `Non-HTML response from ${url} (Content-Type: ${contentType})`,
      true,
      "NON_HTML_CONTENT"
    );
  }

  // Read the body; stream failures after headers arrive are treated as transient.
  let html: string;
  try {
    html = await response.text();
  } catch (err: unknown) {
    throw new FetchError(
      `Failed reading response body from ${url}: ${(err as Error).message}`,
      false,
      "BODY_READ_ERROR",
      { cause: err }
    );
  }

  // Pre-truncate raw HTML before running expensive regex operations.
  // maxChars * 8 gives headroom for the markup that extractText strips away.
  const rawHtml = html.length > maxChars * 8 ? html.slice(0, maxChars * 8) : html;

  let text = extractText(rawHtml);
  if (!text) {
    text = spaFallback(rawHtml, url);
  }

  return text.slice(0, maxChars);
}
