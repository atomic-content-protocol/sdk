import { promises as dns } from "node:dns";
import { isIP } from "node:net";

import { FetchError, ValidationError } from "./errors.js";

const DEFAULT_MAX_CHARS = 100_000;
const MAX_RESPONSE_BYTES = 10_000_000; // 10 MB hard cap, enforced on the stream
const TIMEOUT_MS = 15_000;
/** Redirect hops followed before giving up. Each hop is re-validated. */
const MAX_REDIRECTS = 5;
const DEFAULT_USER_AGENT = "ACP-SDK/0.2";
/**
 * Bound applied to the STRIPPED HTML handed to zone selection, so extraction
 * stays O(n) with a small n. Applying this to the raw HTML instead silently
 * truncated every page that front-loads large inline CSS or JSON.
 */
const MAX_HTML_FOR_EXTRACTION = 300_000;
/** Prefix scanned for `<title>`, og: tags and the meta description. All live in `<head>`. */
const MAX_HTML_FOR_META = 300_000;

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

/**
 * Remove every `<tag …>…</tag>` element (case-insensitive) in one pass.
 *
 * An opener with no matching close is treated as a stray tag: the opener itself
 * is dropped and scanning continues. It must NOT discard the rest of the
 * document. Doing so silently destroyed real pages — a single unterminated
 * `<style>` near the end of a truncated page threw away everything after it,
 * and the extractor returned nothing but the `<title>`.
 *
 * The content of an unterminated raw-text element (`script`, `style`) is kept
 * and may surface as text. That is the deliberate trade: leaking a fragment of
 * a malformed page is recoverable, losing the whole page silently is not.
 */
function stripElements(html: string, tag: string): string {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  let out = "";
  let pos = 0;
  // Latches once a close tag is known to be absent from the remainder. `indexOf`
  // has then already proven no `</tag>` exists at or after that offset, so none
  // can exist later either. Without it, a page carrying thousands of unclosed
  // openers would rescan the tail once per opener and go quadratic — exactly the
  // CPU exhaustion this module was rewritten to prevent.
  let noMoreCloses = false;
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
    const closeAt = noMoreCloses ? -1 : lower.indexOf(close, start);
    if (closeAt === -1) {
      noMoreCloses = true;
      const openGt = lower.indexOf(">", start);
      if (openGt === -1) return out; // opener never terminates: nothing usable follows
      pos = openGt + 1; // drop the stray opener, keep everything after it
      continue;
    }
    const gt = lower.indexOf(">", closeAt);
    pos = gt === -1 ? lower.length : gt + 1;
  }
  return out + html.slice(pos);
}

/**
 * Inner HTML of the LARGEST top-level `<tag …>…</tag>` element, or undefined.
 *
 * Taking the *first* match was wrong on real pages. Content sites mark their
 * related-post teaser cards up as `<article>`, so the first one in document
 * order is routinely a 200-character advert for an unrelated post. One saved
 * card ended up with an ACO summarising a meal-replacement powder because the
 * first `<article>` on a treadmill buying guide was a teaser for a Huel review.
 *
 * Nesting is tracked with a depth counter so an `<article>` inside an
 * `<article>` does not terminate its parent at the inner `</article>`.
 *
 * Linear: every opener and closer position is visited at most once.
 */
function largestInnerOf(html: string, tag: string): string | undefined {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;

  const isBoundary = (at: number): boolean => {
    const c = lower.charCodeAt(at);
    return Number.isNaN(c) || c === 62 /* > */ || c === 32 || c === 47 /* / */ || c === 9 || c === 10 || c === 13;
  };

  let best: string | undefined;
  let pos = 0;
  let depth = 0;
  let contentStart = -1;

  for (;;) {
    const nextOpen = lower.indexOf(open, pos);
    const nextClose = lower.indexOf(close, pos);
    if (nextOpen === -1 && nextClose === -1) break;

    const openFirst = nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose);
    if (openFirst) {
      if (!isBoundary(nextOpen + open.length)) {
        pos = nextOpen + open.length;
        continue;
      }
      const gt = lower.indexOf(">", nextOpen);
      if (gt === -1) break;
      if (depth === 0) contentStart = gt + 1;
      depth += 1;
      pos = gt + 1;
      continue;
    }

    if (!isBoundary(nextClose + close.length)) {
      pos = nextClose + close.length;
      continue;
    }
    if (depth > 0) {
      depth -= 1;
      if (depth === 0 && contentStart !== -1) {
        const inner = html.slice(contentStart, nextClose);
        if (best === undefined || inner.length > best.length) best = inner;
        contentStart = -1;
      }
    }
    const gt = lower.indexOf(">", nextClose);
    pos = gt === -1 ? nextClose + close.length : gt + 1;
  }

  // An element left open at end-of-input (truncated page): take what we have.
  if (best === undefined && depth > 0 && contentStart !== -1) {
    return html.slice(contentStart);
  }
  return best;
}

const STRIPPED_TAGS = ["script", "style", "noscript", "iframe", "nav", "footer", "header", "aside"];

/**
 * Minimum share of the page's own text a semantic zone must hold to be believed.
 * Below this it is a teaser card, a comment block or a sidebar promo rather than
 * the article, and the full body is the better answer.
 */
const ZONE_MIN_TEXT_SHARE = 0.25;

const flatten = (html: string): string => stripTags(html).replace(/\s+/g, " ").trim();

function extractText(html: string): string {
  let stripped = html;
  for (const tag of STRIPPED_TAGS) stripped = stripElements(stripped, tag);

  // Cap AFTER stripping, never before. Capping the raw HTML discarded the
  // content of any page that front-loads large inline assets: a WordPress page
  // carrying 276 KB of inline <style> put its entire article past the cut, so
  // the extractor saw only <head> and returned the page title alone. Stripping
  // first takes that same page from 654 KB to 94 KB, article included.
  if (stripped.length > MAX_HTML_FOR_EXTRACTION) {
    stripped = stripped.slice(0, MAX_HTML_FOR_EXTRACTION);
  }

  const bodyText = flatten(largestInnerOf(stripped, "body") ?? stripped);
  const floor = bodyText.length * ZONE_MIN_TEXT_SHARE;

  // Precedence is article, then main, then body — NOT "whichever is biggest".
  // `<main>` normally wraps `<article>`, so it is always at least as large while
  // also carrying the page chrome. Picking the larger of the two therefore chose
  // `<main>` by a rounding margin and dragged an icon-font sprite in ahead of the
  // article. Since only the first few thousand characters of the body ever reach
  // the model, leading chrome displaces the content it is meant to summarise.
  //
  // Within a single tag the largest instance still wins, which is what keeps a
  // related-post teaser from being mistaken for the article.
  for (const tag of ["article", "main"] as const) {
    const inner = largestInnerOf(stripped, tag);
    if (inner === undefined) continue;
    const text = flatten(inner);
    if (text.length >= floor) return text;
  }

  return bodyText;
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
// Redirect-following fetch
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch `startUrl`, following redirects manually.
 *
 * Every hop — not just the first — goes through `validateUrl` and
 * `assertResolvesPublic`, so an open redirector cannot walk us to a private
 * address, an `http://` downgrade, or a blocked host. Refusing redirects
 * outright (the previous behaviour) was equally safe but broke ordinary URLs:
 * moved pages, `www.` normalisation and trailing-slash canonicalisation all
 * answer 3xx.
 *
 * One deadline covers the whole chain, so N hops cannot multiply the timeout.
 */
async function fetchFollowingRedirects(
  startUrl: string,
  userAgent: string
): Promise<{ response: Response; finalUrl: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = startUrl;

  for (let hop = 0; ; hop++) {
    const host = validateUrl(current);
    await assertResolvesPublic(host, current);

    let response: Response;
    try {
      response = await fetch(current, {
        headers: { "User-Agent": userAgent },
        redirect: "manual",
        signal,
      });
    } catch (err: unknown) {
      const code = errnoCode(err);
      const permanent = code !== undefined && PERMANENT_NETWORK_CODES.has(code);
      throw new FetchError(`Network error fetching ${current}: ${(err as Error).message}`, permanent, code, {
        cause: err,
      });
    }

    const location = response.headers.get("location");
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      return { response, finalUrl: current };
    }

    if (hop >= MAX_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw new FetchError(
        `Too many redirects (more than ${MAX_REDIRECTS}) starting at ${startUrl}`,
        true,
        "TOO_MANY_REDIRECTS"
      );
    }

    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      await response.body?.cancel().catch(() => undefined);
      throw new FetchError(`Invalid redirect target "${location}" from ${current}`, true, "INVALID_REDIRECT");
    }

    await response.body?.cancel().catch(() => undefined);
    current = next;
  }
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
  /** URL the content actually came from: the input, or the last hop if it redirected. */
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
 * Redirects are followed (up to 5 hops) with every hop re-validated against
 * the same SSRF guard, so an open redirector cannot reach a private address
 * or downgrade to http. Node.js ≥ 20 is required (enforced in package.json
 * engines).
 */
export async function fetchPageForUrl(url: string, options?: FetchBodyOptions): Promise<FetchedPage> {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;

  const { response, finalUrl } = await fetchFollowingRedirects(url, userAgent);

  if (!response.ok) {
    const permanent = response.status >= 400 && response.status < 500;
    throw new FetchError(`HTTP ${response.status} fetching ${finalUrl}`, permanent, `HTTP_${response.status}`);
  }

  // Refuse unexpectedly large responses before loading into memory.
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
    throw new FetchError(
      `Response too large from ${finalUrl} (Content-Length: ${contentLength})`,
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
    throw new FetchError(`Non-HTML response from ${finalUrl} (Content-Type: ${contentType})`, true, "NON_HTML_CONTENT");
  }

  // Read the body; stream failures after headers arrive are treated as transient.
  let html: string;
  try {
    html = await readBodyCapped(response, finalUrl);
  } catch (err: unknown) {
    if (err instanceof FetchError) throw err;
    throw new FetchError(
      `Failed reading response body from ${finalUrl}: ${(err as Error).message}`,
      false,
      "BODY_READ_ERROR",
      { cause: err }
    );
  }

  // `<title>`, og: tags and the meta description all live in `<head>`, so a
  // bounded prefix is enough and keeps this cheap on very large documents.
  const metaHtml = html.length > MAX_HTML_FOR_META ? html.slice(0, MAX_HTML_FOR_META) : html;
  const title = metaContent(metaHtml, "property", "og:title") ?? pageTitle(metaHtml);
  const ogImage = metaContent(metaHtml, "property", "og:image");
  const description = metaContent(metaHtml, "name", "description");

  // Text extraction gets the WHOLE document. It strips script/style/nav first
  // and applies MAX_HTML_FOR_EXTRACTION to the stripped result, so the bound on
  // extraction cost is preserved without cutting the article off the page.
  // The total input is already bounded by MAX_RESPONSE_BYTES on the stream.
  let text = extractText(html);
  if (!text) {
    text = spaFallback(metaHtml, finalUrl);
  }

  return {
    text: text.slice(0, maxChars),
    ...(title ? { title: decodeEntities(title) } : {}),
    ...(ogImage ? { ogImage } : {}),
    ...(description ? { description: decodeEntities(description) } : {}),
    url: finalUrl,
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

/**
 * Shortest extraction that can honestly support a summary, tags and entities.
 *
 * Chosen by measuring real saved pages: genuine articles extract to thousands of
 * characters, while a failed extraction lands at the page title or a teaser card
 * of a few hundred. A page below this yielded a confident ACO about the wrong
 * subject, which is worse than no ACO at all.
 */
export const MIN_FETCHED_BODY_CHARS = 400;

/**
 * True when a *fetched* body is too thin to enrich honestly — the extraction
 * failed even though the request succeeded.
 *
 * Only ever apply this to fetched content. A short body the caller supplied (a
 * one-line note, a highlighted quote) is legitimate and must not be gated.
 */
export function isExtractionTooThin(text: string, title?: string): boolean {
  const body = text.trim();
  if (body.length < MIN_FETCHED_BODY_CHARS) return true;

  // Some pages extract to nothing but their own title repeated. Longer than the
  // floor, but it carries no information the ACO does not already hold.
  if (title) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const t = norm(title);
    if (t.length > 0 && norm(body).replace(t, "").trim().length < MIN_FETCHED_BODY_CHARS) return true;
  }
  return false;
}
