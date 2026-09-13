// Vercel Edge Function — same-origin fetch proxy for the playground.
// GET /api/fetch-url?url=https://example.com
//
// Guard rails (this endpoint used to be an open, edge-cached proxy):
//   - HTTPS only; redirects are not followed (open-redirect → private IP).
//   - Literal private / loopback / link-local / metadata addresses and
//     internal hostnames are refused. (DNS-resolution checks are not
//     available at the edge; the hosted MCP server does those.)
//   - Only text/html and text/plain responses are relayed, capped at 1 MB,
//     read as a stream so a chunked body cannot exhaust memory.
//   - Browser callers must be same-origin or an allow-listed origin; other
//     origins get no CORS header. Responses are never cached publicly.
//   - Upstream status is preserved instead of being flattened to 200.

export const config = { runtime: "edge" };

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 15_000;

const ALLOWED_ORIGINS = new Set([
  "https://atomiccontentprotocol.org",
  "https://www.atomiccontentprotocol.org",
]);

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];

function ipv4Blocked(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6Blocked(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("::ffff:")) {
    const tail = h.slice(7);
    return tail.includes(".") ? ipv4Blocked(tail) : true;
  }
  if (h.startsWith("64:ff9b:")) return true; // NAT64
  const first = h.split(":")[0] ?? "";
  if (/^f[cd]/.test(first)) return true; // fc00::/7
  if (/^fe[89ab]/.test(first)) return true; // fe80::/10
  if (/^ff/.test(first)) return true; // multicast
  if (first === "2001" && h.split(":")[1] === "db8") return true;
  return false;
}

function validateTarget(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Only HTTPS URLs are allowed" };
  if (url.username || url.password) return { ok: false, error: "Credentials in URL are not allowed" };

  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return { ok: false, error: "Invalid URL" };
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, error: "Blocked host" };
  }
  const isV4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const isV6 = host.includes(":");
  if (isV4 && ipv4Blocked(host)) return { ok: false, error: "Blocked address" };
  if (isV6 && ipv6Blocked(host)) return { ok: false, error: "Blocked address" };
  if (!isV4 && !isV6 && !host.includes(".")) return { ok: false, error: "Blocked host" };
  return { ok: true, url };
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { Vary: "Origin", "Cache-Control": "private, no-store" };
  if (origin && (ALLOWED_ORIGINS.has(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(request: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(request), "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "600" },
    });
  }
  if (request.method !== "GET") return json(request, 405, { error: "Method not allowed" });

  // Browser callers must be same-origin (no Origin header on same-origin GET)
  // or an allow-listed origin.
  const origin = request.headers.get("origin");
  if (origin && !corsHeaders(request)["Access-Control-Allow-Origin"]) {
    return json(request, 403, { error: "Origin not allowed" });
  }

  const target = new URL(request.url).searchParams.get("url");
  if (!target) return json(request, 400, { error: "Missing ?url= parameter" });

  const check = validateTarget(target);
  if (!check.ok) return json(request, 400, { error: check.error });

  let upstream: Response;
  try {
    upstream = await fetch(check.url.toString(), {
      headers: {
        "User-Agent": "ACP-Playground/1.0 (https://atomiccontentprotocol.org)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error && err.name === "TimeoutError" ? "Upstream timed out" : "Fetch failed";
    return json(request, 502, { error: message });
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return json(request, 502, { error: "Redirects are not followed" });
  }
  if (!upstream.ok) return json(request, 502, { error: `Upstream returned ${upstream.status}` });

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/.test(contentType)) {
    return json(request, 415, { error: "Unsupported upstream content type" });
  }

  const length = Number(upstream.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return json(request, 413, { error: "Upstream response too large" });

  const html = await readCapped(upstream);
  if (html === null) return json(request, 413, { error: "Upstream response too large" });

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", ...corsHeaders(request) },
  });
}
