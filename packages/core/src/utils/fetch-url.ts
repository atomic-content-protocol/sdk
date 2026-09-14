import { promises as dns } from "node:dns";
import { isIP } from "node:net";

import { FetchError, ValidationError } from "./errors.js";

const DEFAULT_MAX_CHARS = 100_000;
const MAX_RESPONSE_BYTES = 10_000_000; // 10 MB hard cap, enforced on the stream
const TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT = "ACP-SDK/0.2";
/** Raw HTML handed to the text extractor. Bounded so extraction stays O(n) with a small n. */
const MAX_HTML_FOR_EXTRACTION = 300_000;

// Hoisted to module scope — not recreated on every call.
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];
const PERMANENT_NETWORK_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);

export interface FetchBodyOptions {
  maxChars?: number;
  /** Override the User-Agent header sent with the request. */
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

/** Parse dotted-quad IPv4 into a 32-bit unsigned integer. */
function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) | Number.parseInt(octet, 10)) >>> 0, 0);
}

/** [network, prefixLength] pairs that must never be fetched. */
const BLOCKED_V4: Array<[number, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // shared address space / CGNAT (cloud metadata on some providers)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (AWS/GCP/Azure metadata)
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
].map(([net, bits]) => [ipv4ToInt(net as string), bits as number]);

/** True if `ip` (dotted quad) is in a blocked IPv4 range. */
export function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === net;
  });
}

/** Expand an IPv6 address into eight 16-bit groups. Returns null if unparseable. */
function ipv6Groups(ip: string): number[] | null {
  let addr = ip;
  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1) → convert to two hex groups.
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const v4 = ipv4ToInt(tail);
    addr = `${addr.slice(0, lastColon)}:${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...rest].map((g) => Number.parseInt(g || "0", 16));
  return groups.every((g) => Number.isFinite(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True if `ip` is an IPv6 address in a blocked range. */
export function isBlockedIPv6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (g === null) return true; // refuse anything we cannot reason about
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const isZeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  // :: (unspecified) and ::1 (loopback)
  if (isZeroPrefix && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
  // ::ffff:a.b.c.d — IPv4-mapped; defer to the IPv4 rules
  if (isZeroPrefix && g5 === 0xffff) {
    return isBlockedIPv4(`${g6 >>> 8}.${g6 & 0xff}.${g7 >>> 8}.${g7 & 0xff}`);
  }
  // 64:ff9b::/96 — NAT64 well-known prefix wrapping IPv4
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIPv4(`${g6 >>> 8}.${g6 & 0xff}.${g7 >>> 8}.${g7 & 0xff}`);
  }
  // ::a.b.c.d — deprecated IPv4-compatible form (::/96 other than :: and ::1)
  if (isZeroPrefix && g5 === 0) return true;
  // 2002::/16 — 6to4: embeds an IPv4 address in g1:g2
  if (g0 === 0x2002) return isBlockedIPv4(`${g1 >>> 8}.${g1 & 0xff}.${g2 >>> 8}.${g2 & 0xff}`);
  // 2001::/32 — Teredo tunnelling
  if (g0 === 0x2001 && g1 === 0) return true;
  // 100::/64 — discard-only
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // 64:ff9b:1::/48 — local-use NAT64
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true;
  // fc00::/7 unique local
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast
  if ((g0 & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 documentation
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  return false;
}

/** True if a literal IP address must not be fetched. */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return true;
}

/** Normalise a hostname from the WHATWG URL API: lowercase, no brackets, no trailing dot. */
function normaliseHost(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/**
 * Synchronous checks on the URL itself: scheme, blocked names, literal IPs.
 * Returns the normalised hostname for the subsequent DNS check.
 */
function validateUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new ValidationError(`Only HTTPS URLs are allowed, got: ${parsed.protocol}`);
  }

  if (parsed.username || parsed.password) {
    throw new ValidationError("URLs with embedded credentials are not allowed");
  }

  const host = normaliseHost(parsed.hostname);
  if (!host) throw new ValidationError(`Invalid URL: ${url}`);

  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new ValidationError(`Blocked host: ${host}`);
  }

  // Single-label hostnames (no dot) resolve via search domains — refuse them.
  if (!host.includes(".") && isIP(host) === 0) {
    throw new ValidationError(`Blocked host: ${host}`);
  }

  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new ValidationError(`Blocked private/link-local address: ${host}`);
  }

  return host;
}

/**
 * Resolve `host` and refuse it if any returned address is in a blocked range.
 * Literal IPs were already checked by `validateUrl` and are skipped here.
 *
 * Note: a hostile DNS server can still return a public address to us and a
 * private one to the subsequent fetch (DNS rebinding). Closing that window
 * requires pinning the connection to the resolved address, which Node's fetch
 * does not expose; the redirect refusal below limits the blast radius.
 */
async function assertResolvesPublic(host: string, url: string): Promise<void> {
  if (isIP(host) !== 0) return;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch (err: unknown) {
    const code = errnoCode(err) ?? "ENOTFOUND";
    throw new FetchError(
      `DNS lookup failed for ${url}: ${(err as Error).message}`,
      PERMANENT_NETWORK_CODES.has(code),
      code,
      { cause: err }
    );
  }
  if (addresses.length === 0) {
    throw new FetchError(`DNS lookup returned no addresses for ${url}`, true, "ENOTFOUND");
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new ValidationError(`Blocked host: ${host} resolves to a private/link-local address (${address})`);
    }
  }
}

/**
 * Extract a Node errno code from a thrown value. Node's `fetch` rejects with a
 * `TypeError("fetch failed")` whose `cause` carries the real errno, so we
 * check both the error and its cause chain.
 */
function errnoCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// HTML content extraction
//
// Everything here is linear in the input: single forward scans with indexOf
// and bounded-length regexes. Backtracking patterns such as
// `<script[^>]*>[\s\S]*?</script>` are quadratic on adversarial input
// (thousands of unclosed tags) and turned URL enrichment into a CPU DoS.
// ---------------------------------------------------------------------------

/** Remove every `<tag …>…</tag>` element (case-insensitive) in one pass. Unclosed tags drop the rest. */
function stripElements(html: string, tag: string): string {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  let out = "";
  let pos = 0;
  for (;;) {
    const start = lower.indexOf(open, pos);
    if (start === -1) break;
    // Must be a real tag boundary: "<nav" but not "<navigation-menu".
    const after = lower.charCodeAt(start + open.length);
    const boundary =
      Number.isNaN(after) ||
      after === 62 /* > */ ||
      after === 32 ||
      after === 47 ||
      after === 9 ||
      after === 10 ||
      after === 13;
    if (!boundary) {
      out += html.slice(pos, start + open.length);
      pos = start + open.length;
      continue;
    }
    out += html.slice(pos, start);
    const closeAt = lower.indexOf(close, start);
    if (closeAt === -1) return out; // unclosed: discard remainder
    const gt = lower.indexOf(">", closeAt);
    pos = gt === -1 ? lower.length : gt + 1;
  }
  return out + html.slice(pos);
}

/** Inner HTML of the first `<tag …>…</tag>` element, or undefined. Linear. */
function innerOf(html: string, tag: string): string | undefined {
  const lower = html.toLowerCase();
  let start = lower.indexOf(`<${tag}`);
  while (start !== -1) {
    const after = lower.charCodeAt(start + tag.length + 1);
    if (after === 62 || after === 32 || after === 9 || after === 10 || after === 13) break;
    start = lower.indexOf(`<${tag}`, start + 1);
  }
  if (start === -1) return undefined;
  const gt = lower.indexOf(">", start);
  if (gt === -1) return undefined;
  const closeAt = lower.indexOf(`</${tag}`, gt + 1);
  return closeAt === -1 ? undefined : html.slice(gt + 1, closeAt);
}

const STRIPPED_TAGS = ["script", "style", "noscript", "iframe", "nav", "footer", "header", "aside"];

function extractText(html: string): string {
  let stripped = html;
  for (const tag of STRIPPED_TAGS) stripped = stripElements(stripped, tag);

  // Prefer semantic content zones: article > main > body
  const zone = innerOf(stripped, "article") ?? innerOf(stripped, "main") ?? innerOf(stripped, "body") ?? stripped;

  return stripTags(zone).replace(/\s+/g, " ").trim();
}

/** Longest tag we are willing to inspect; anything longer is treated as text. */
const MAX_TAG_LENGTH = 5_000;

/**
 * Iterate `<name …>` tags by name using indexOf scans only. Each tag is
 * located with two memchr-speed searches, so cost is O(n) regardless of how
 * many unterminated openers the page contains.
 */
function* tagsNamed(html: string, name: string): Generator<string> {
  const lower = html.toLowerCase();
  const needle = `<${name}`;
  let pos = 0;
  for (;;) {
    const start = lower.indexOf(needle, pos);
    if (start === -1) return;
    pos = start + needle.length;
    const after = lower.charCodeAt(pos);
    if (!(after === 62 || after === 32 || after === 47 || after === 9 || after === 10 || after === 13)) continue;
    const gt = lower.indexOf(">", pos);
    if (gt === -1) return;
    if (gt - start > MAX_TAG_LENGTH) continue; // absurdly long "tag": skip it
    yield html.slice(pos, gt);
    pos = gt + 1;
  }
}

/** Parse `name="value"` / `name='value'` / `name=value` pairs from the inside of one tag. */
function tagAttributes(tagInner: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]{0,63})\s*=\s*(?:"([^"]{0,4000})"|'([^']{0,4000})'|([^\s"'=<>`]{1,4000}))/g;
  for (const m of tagInner.matchAll(re)) {
    attrs[(m[1] as string).toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "") as string;
  }
  return attrs;
}

/** Replace every `<…>` tag with a space, linearly; a `<` with no `>` within MAX_TAG_LENGTH is kept as text. */
function stripTags(html: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) break;
    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) break;
    if (gt - lt > MAX_TAG_LENGTH) {
      out += html.slice(pos, lt + 1);
      pos = lt + 1;
      continue;
    }
    out += `${html.slice(pos, lt)} `;
    pos = gt + 1;
  }
  return out + html.slice(pos);
}

// Extract a <meta> tag's content attribute where `attr` equals `value`
// (e.g. property="og:title", name="description"). Attribute order and quote
// style do not matter.
function metaContent(html: string, attr: string, value: string): string | undefined {
  const want = value.toLowerCase();
  for (const inner of tagsNamed(html, "meta")) {
    const attrs = tagAttributes(inner);
    if (attrs[attr]?.toLowerCase() === want && attrs["content"]) return attrs["content"];
  }
  return undefined;
}

function pageTitle(html: string): string | undefined {
  const m = /<title\b[^>]{0,500}>([^<]{0,1000})<\/title>/i.exec(html);
  return m?.[1]?.trim() || undefined;
}

// SPA / empty-body fallback: synthesise signal from meta tags so the LLM
// enrichment step still has something to work with.
function spaFallback(html: string, url: string): string {
  const title = pageTitle(html);
  const ogTitle = metaContent(html, "property", "og:title");
  const metaDesc = metaContent(html, "name", "description");

  return [ogTitle ?? title, metaDesc, url].filter(Boolean).join(" — ");
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

/**
 * Read the response body as text, enforcing `MAX_RESPONSE_BYTES` on the
 * stream itself so a chunked response without Content-Length cannot exhaust
 * memory. Falls back to `text()` when no readable stream is exposed.
 */
async function readBodyCapped(response: Response, url: string): Promise<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    return response.text();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new FetchError(
          `Response too large from ${url} (exceeded ${MAX_RESPONSE_BYTES} bytes)`,
          false,
          "RESPONSE_TOO_LARGE"
        );
      }
      chunks.push(value);
    }
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Result of `fetchPageForUrl`: extracted text plus lightweight page metadata. */
export interface FetchedPage {
  /** Main text content, truncated to `maxChars`. */
  text: string;
  /** `og:title` or `<title>`, when present. */
  title?: string;
  /** `og:image` URL, when present. */
  ogImage?: string;
  /** Meta description, when present. */
  description?: string;
  /** Final URL requested (redirects are refused, so identical to the input). */
  url: string;
}

/**
 * fetchPageForUrl — fetch a URL, extract its main text content and basic
 * metadata (title, og:image, description).
 *
 * Throws `ValidationError` for SSRF-unsafe URLs (non-HTTPS, private IPs,
 * hostnames that resolve to private IPs, embedded credentials, etc.).
 * Throws `FetchError` for network errors, HTTP 4xx/5xx, oversized/non-HTML
 * responses, and body-read failures. `FetchError.permanent` indicates whether
 * the caller should retry; `FetchError.networkCode` gives the machine-readable
 * failure reason (e.g. "ENOTFOUND", "HTTP_404", "NON_HTML_CONTENT").
 *
 * HTTP redirects are refused (`redirect: "error"`) to prevent SSRF via open
 * redirectors. Node.js ≥ 20 is required (enforced in package.json engines).
 */
export async function fetchPageForUrl(url: string, options?: FetchBodyOptions): Promise<FetchedPage> {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;

  const host = validateUrl(url);
  await assertResolvesPublic(host, url);

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
    const code = errnoCode(err);
    const permanent = code !== undefined && PERMANENT_NETWORK_CODES.has(code);
    throw new FetchError(`Network error fetching ${url}: ${(err as Error).message}`, permanent, code, { cause: err });
  }

  if (!response.ok) {
    const permanent = response.status >= 400 && response.status < 500;
    throw new FetchError(`HTTP ${response.status} fetching ${url}`, permanent, `HTTP_${response.status}`);
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
    throw new FetchError(`Non-HTML response from ${url} (Content-Type: ${contentType})`, true, "NON_HTML_CONTENT");
  }

  // Read the body; stream failures after headers arrive are treated as transient.
  let html: string;
  try {
    html = await readBodyCapped(response, url);
  } catch (err: unknown) {
    if (err instanceof FetchError) throw err;
    throw new FetchError(
      `Failed reading response body from ${url}: ${(err as Error).message}`,
      false,
      "BODY_READ_ERROR",
      { cause: err }
    );
  }

  // Bound the HTML handed to the extractor: enough for any real article's
  // main content, small enough that extraction is always cheap.
  const cap = Math.min(MAX_HTML_FOR_EXTRACTION, maxChars * 8);
  const rawHtml = html.length > cap ? html.slice(0, cap) : html;

  const title = metaContent(rawHtml, "property", "og:title") ?? pageTitle(rawHtml);
  const ogImage = metaContent(rawHtml, "property", "og:image");
  const description = metaContent(rawHtml, "name", "description");

  let text = extractText(rawHtml);
  if (!text) {
    text = spaFallback(rawHtml, url);
  }

  return {
    text: text.slice(0, maxChars),
    ...(title ? { title: decodeEntities(title) } : {}),
    ...(ogImage ? { ogImage } : {}),
    ...(description ? { description: decodeEntities(description) } : {}),
    url,
  };
}

/** Minimal HTML entity decoding for title/description strings. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * fetchBodyForUrl — fetch a URL and extract its main text content.
 * Thin wrapper over `fetchPageForUrl` kept for API stability; see that
 * function for the full error contract.
 */
export async function fetchBodyForUrl(url: string, options?: FetchBodyOptions): Promise<string> {
  return (await fetchPageForUrl(url, options)).text;
}
