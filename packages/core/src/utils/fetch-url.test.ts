import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createACO } from "../index.js";
import { FetchError, ValidationError } from "./errors.js";
import { fetchBodyForUrl, fetchPageForUrl, isBlockedAddress } from "./fetch-url.js";

const AUTHOR = { id: "test", name: "Test" };

// ---------------------------------------------------------------------------
// DNS mock — fetchBodyForUrl resolves hostnames before fetching so hostnames
// pointing at private IPs are refused. Default every lookup to a public IP;
// individual tests override via `mockDns`.
// ---------------------------------------------------------------------------

const dnsLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({ promises: { lookup: dnsLookup } }));

function mockDns(addresses: string[]) {
  dnsLookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
}

beforeEach(() => {
  dnsLookup.mockReset();
  mockDns(["93.184.216.34"]);
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockFetch(
  html: string,
  status = 200,
  headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" }
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
      text: async () => html,
    })
  );
}

/**
 * Mirror Node's real failure shape: `fetch` rejects with a TypeError whose
 * `cause` carries the errno. A second helper keeps the legacy top-level shape.
 */
function mockNetworkError(code: string) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed", { cause: Object.assign(new Error(`mock: ${code}`), { code }) }))
  );
}

function mockNetworkErrorTopLevel(code: string) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error(`mock: ${code}`), { code })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. SSRF validation
// ---------------------------------------------------------------------------

describe("fetchBodyForUrl — SSRF validation", () => {
  it("throws ValidationError for http:// URL", async () => {
    await expect(fetchBodyForUrl("http://example.com")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for ftp:// URL", async () => {
    await expect(fetchBodyForUrl("ftp://example.com/file")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for a non-parseable string", async () => {
    await expect(fetchBodyForUrl("not-a-url")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for localhost", async () => {
    await expect(fetchBodyForUrl("https://localhost/anything")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 127.0.0.1", async () => {
    await expect(fetchBodyForUrl("https://127.0.0.1/")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for ::1 (IPv6 loopback)", async () => {
    await expect(fetchBodyForUrl("https://[::1]/")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 169.254.x.x (link-local)", async () => {
    await expect(fetchBodyForUrl("https://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 10.x.x.x (RFC 1918 class A)", async () => {
    await expect(fetchBodyForUrl("https://10.0.0.1/admin")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 192.168.x.x (RFC 1918 class C)", async () => {
    await expect(fetchBodyForUrl("https://192.168.1.50/")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 172.16.x.x (RFC 1918 class B)", async () => {
    await expect(fetchBodyForUrl("https://172.16.0.1/")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 172.31.x.x (RFC 1918 class B upper)", async () => {
    await expect(fetchBodyForUrl("https://172.31.255.255/")).rejects.toBeInstanceOf(ValidationError);
  });

  it("does NOT block 172.15.x.x (just outside RFC 1918 range)", async () => {
    mockFetch("<html><body>ok</body></html>");
    // Should not throw ValidationError (may throw FetchError from mock, but not SSRF)
    const err = await fetchBodyForUrl("https://172.15.0.1/").catch((e) => e);
    expect(err).not.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for *.local domain", async () => {
    await expect(fetchBodyForUrl("https://my-service.local/")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for *.internal domain", async () => {
    await expect(fetchBodyForUrl("https://api.server.internal/")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for metadata.google.internal", async () => {
    await expect(fetchBodyForUrl("https://metadata.google.internal/")).rejects.toBeInstanceOf(ValidationError);
  });

  it.each([
    ["https://127.0.0.2/", "loopback /8 beyond .1"],
    ["https://0.0.0.0/", "unspecified"],
    ["https://100.100.100.200/", "shared address space 100.64/10"],
    ["https://[::ffff:127.0.0.1]/", "IPv4-mapped loopback"],
    ["https://[::ffff:10.0.0.1]/", "IPv4-mapped RFC 1918"],
    ["https://[fe80::1]/", "IPv6 link-local"],
    ["https://[fd00::1]/", "IPv6 unique local"],
    ["https://[64:ff9b::7f00:1]/", "NAT64-wrapped loopback"],
    ["https://localhost./", "trailing-dot localhost"],
    ["https://LOCALHOST/", "uppercase localhost"],
    ["https://intranet/", "single-label hostname"],
    ["https://user:pw@example.com/", "embedded credentials"],
    ["https://foo.localhost/", ".localhost suffix"],
  ])("throws ValidationError for %s (%s)", async (url) => {
    await expect(fetchBodyForUrl(url)).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when the hostname resolves to a private IP", async () => {
    mockDns(["10.1.2.3"]);
    mockFetch("<p>hi</p>");
    await expect(fetchBodyForUrl("https://evil.example.com")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when ANY resolved address is private", async () => {
    mockDns(["93.184.216.34", "169.254.169.254"]);
    mockFetch("<p>hi</p>");
    await expect(fetchBodyForUrl("https://mixed.example.com")).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps a DNS failure to FetchError (permanent, ENOTFOUND)", async () => {
    dnsLookup.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    const err = await fetchBodyForUrl("https://nope.example.com").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(true);
    expect((err as FetchError).networkCode).toBe("ENOTFOUND");
  });

  it("does not consult DNS for literal public IPs", async () => {
    mockFetch("<p>hi</p>");
    await fetchBodyForUrl("https://93.184.216.34/");
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it("does not throw for a valid HTTPS URL", async () => {
    mockFetch("<html><body>Hello</body></html>");
    await expect(fetchBodyForUrl("https://example.com")).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP error mapping
// ---------------------------------------------------------------------------

describe("fetchBodyForUrl — HTTP error mapping", () => {
  it("404 → FetchError with permanent: true, networkCode: HTTP_404", async () => {
    mockFetch("Not Found", 404);
    const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(true);
    expect((err as FetchError).networkCode).toBe("HTTP_404");
  });

  it("403 → FetchError with permanent: true, networkCode: HTTP_403", async () => {
    mockFetch("Forbidden", 403);
    const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(true);
    expect((err as FetchError).networkCode).toBe("HTTP_403");
  });

  it("500 → FetchError with permanent: false, networkCode: HTTP_500", async () => {
    mockFetch("Server Error", 500);
    const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(false);
    expect((err as FetchError).networkCode).toBe("HTTP_500");
  });

  it("503 → FetchError with permanent: false, networkCode: HTTP_503", async () => {
    mockFetch("Unavailable", 503);
    const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(false);
    expect((err as FetchError).networkCode).toBe("HTTP_503");
  });
});

// ---------------------------------------------------------------------------
// 3. Network error mapping
// ---------------------------------------------------------------------------

describe("fetchBodyForUrl — network error mapping", () => {
  it.each([["ENOTFOUND"], ["ECONNREFUSED"], ["EAI_AGAIN"]])(
    "%s → FetchError with permanent: true and networkCode set",
    async (code) => {
      mockNetworkError(code);
      const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
      expect(err).toBeInstanceOf(FetchError);
      expect((err as FetchError).permanent).toBe(true);
      expect((err as FetchError).networkCode).toBe(code);
    }
  );

  it.each([["ETIMEDOUT"], ["ECONNRESET"], ["EPIPE"]])(
    "%s → FetchError with permanent: false and networkCode set",
    async (code) => {
      mockNetworkError(code);
      const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
      expect(err).toBeInstanceOf(FetchError);
      expect((err as FetchError).permanent).toBe(false);
      expect((err as FetchError).networkCode).toBe(code);
    }
  );

  it("also reads a top-level errno code (non-Node fetch implementations)", async () => {
    mockNetworkErrorTopLevel("ECONNREFUSED");
    const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(true);
    expect((err as FetchError).networkCode).toBe("ECONNREFUSED");
  });

  it("a hard network failure with no errno → FetchError with permanent: false (no networkCode)", async () => {
    // Simulate what happens when redirect: "error" causes fetch to throw
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(false);
    expect((err as FetchError).networkCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. HTML extraction
// ---------------------------------------------------------------------------

describe("fetchBodyForUrl — HTML extraction", () => {
  it("prefers <article> content over <main>", async () => {
    mockFetch(`<html><body>
      <main>Main content</main>
      <article>Article content</article>
    </body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).toContain("Article content");
    expect(result).not.toContain("Main content");
  });

  it("falls back to <main> when no <article>", async () => {
    mockFetch(`<html><body>
      <main>Main content</main>
    </body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).toContain("Main content");
  });

  it("falls back to <body> when no <article> or <main>", async () => {
    mockFetch(`<html><body>Body only content</body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).toContain("Body only content");
  });

  it("strips <script> content", async () => {
    mockFetch(`<html><body><script>alert('xss')</script>Real content</body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).not.toContain("alert");
    expect(result).toContain("Real content");
  });

  it("strips <style> content", async () => {
    mockFetch(`<html><body><style>.foo { color: red; }</style>Real content</body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).not.toContain("color");
    expect(result).toContain("Real content");
  });

  it("strips <nav>, <footer>, <header>, <aside> content", async () => {
    mockFetch(`<html><body>
      <nav>Navigation links</nav>
      <header>Site header</header>
      <aside>Sidebar</aside>
      <main>Core article text</main>
      <footer>Footer text</footer>
    </body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).toContain("Core article text");
    expect(result).not.toContain("Navigation links");
    expect(result).not.toContain("Site header");
    expect(result).not.toContain("Sidebar");
    expect(result).not.toContain("Footer text");
  });

  it("strips <noscript> and <iframe> content", async () => {
    mockFetch(`<html><body>
      <noscript>Please enable JS</noscript>
      <iframe src="ad.html">Ad frame</iframe>
      <main>Real content</main>
    </body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).toContain("Real content");
    expect(result).not.toContain("Please enable JS");
  });

  it("normalises multiple whitespace to single space", async () => {
    mockFetch(`<html><body><main>  word1   word2  </main></body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).toBe("word1 word2");
  });
});

// ---------------------------------------------------------------------------
// 5. SPA fallback
// ---------------------------------------------------------------------------

describe("fetchBodyForUrl — SPA fallback", () => {
  it("returns og:title — meta description — url when body is empty", async () => {
    mockFetch(`<html>
      <head>
        <meta property="og:title" content="My Article"/>
        <meta name="description" content="A great read"/>
      </head>
      <body><div id="app"></div></body>
    </html>`);
    const result = await fetchBodyForUrl("https://example.com/article");
    expect(result).toBe("My Article — A great read — https://example.com/article");
  });

  it("uses <title> when og:title absent", async () => {
    mockFetch(`<html>
      <head><title>Page Title</title></head>
      <body><div id="app"></div></body>
    </html>`);
    const result = await fetchBodyForUrl("https://example.com/page");
    expect(result).toContain("Page Title");
    expect(result).toContain("https://example.com/page");
  });

  it("falls back to just the URL when no title or description tags present", async () => {
    mockFetch(`<html><body><div id="app"></div></body></html>`);
    const result = await fetchBodyForUrl("https://example.com/spa");
    expect(result).toBe("https://example.com/spa");
  });

  it("handles single-quoted og:title attribute", async () => {
    mockFetch(`<html>
      <head>
        <meta property='og:title' content='Single Quote Title'/>
      </head>
      <body><div id="app"></div></body>
    </html>`);
    const result = await fetchBodyForUrl("https://example.com/sq");
    expect(result).toContain("Single Quote Title");
  });

  it("handles reversed attribute order (content before property)", async () => {
    mockFetch(`<html>
      <head>
        <meta content="Reversed Order" property="og:title"/>
        <meta content="Reversed desc" name="description"/>
      </head>
      <body><div id="app"></div></body>
    </html>`);
    const result = await fetchBodyForUrl("https://example.com/rev");
    expect(result).toBe("Reversed Order — Reversed desc — https://example.com/rev");
  });
});

// ---------------------------------------------------------------------------
// 5b. Content-Type and Content-Length guards
// ---------------------------------------------------------------------------

describe("fetchBodyForUrl — response guards", () => {
  it("throws FetchError (permanent) for non-HTML content-type", async () => {
    mockFetch("binary data", 200, { "content-type": "application/pdf" });
    const err = await fetchBodyForUrl("https://example.com/file.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(true);
    expect((err as FetchError).networkCode).toBe("NON_HTML_CONTENT");
  });

  it("allows text/plain content-type", async () => {
    mockFetch("plain text content", 200, { "content-type": "text/plain" });
    const result = await fetchBodyForUrl("https://example.com/text");
    expect(result).toContain("plain text content");
  });

  it("allows application/xhtml+xml content-type", async () => {
    mockFetch("<html><body>XHTML content</body></html>", 200, {
      "content-type": "application/xhtml+xml",
    });
    const result = await fetchBodyForUrl("https://example.com/xhtml");
    expect(result).toContain("XHTML content");
  });

  it("allows missing content-type (some servers omit it)", async () => {
    mockFetch("<html><body>No CT header</body></html>", 200, {});
    const result = await fetchBodyForUrl("https://example.com/noct");
    expect(result).toContain("No CT header");
  });

  it("throws FetchError (transient) when Content-Length exceeds 10 MB", async () => {
    mockFetch("body", 200, {
      "content-type": "text/html",
      "content-length": "10000001",
    });
    const err = await fetchBodyForUrl("https://example.com/huge").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).permanent).toBe(false);
    expect((err as FetchError).networkCode).toBe("RESPONSE_TOO_LARGE");
  });

  it("throws FetchError (RESPONSE_TOO_LARGE) when a chunked body exceeds 10 MB without Content-Length", async () => {
    const chunk = new Uint8Array(1_000_000);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 12) controller.close();
        else {
          sent++;
          controller.enqueue(chunk);
        }
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === "content-type" ? "text/html" : null) },
        body: stream,
        text: async () => {
          throw new Error("text() must not be used when body stream is present");
        },
      })
    );
    const err = await fetchBodyForUrl("https://example.com").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).networkCode).toBe("RESPONSE_TOO_LARGE");
  });

  it("reads a streamed body under the cap", async () => {
    const bytes = new TextEncoder().encode("<html><body><p>streamed content</p></body></html>");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === "content-type" ? "text/html" : null) },
        body: stream,
        text: async () => "unused",
      })
    );
    expect(await fetchBodyForUrl("https://example.com")).toBe("streamed content");
  });

  it("does not throw when Content-Length is exactly at the limit (10 MB)", async () => {
    mockFetch("<html><body>ok</body></html>", 200, {
      "content-type": "text/html",
      "content-length": "10000000",
    });
    const result = await fetchBodyForUrl("https://example.com/ok");
    expect(result).toContain("ok");
  });
});

// ---------------------------------------------------------------------------
// 6. Truncation
// ---------------------------------------------------------------------------

describe("fetchBodyForUrl — truncation", () => {
  it("respects a custom maxChars option", async () => {
    mockFetch(`<html><body>${"x".repeat(500)}</body></html>`);
    const result = await fetchBodyForUrl("https://example.com", { maxChars: 10 });
    expect(result.length).toBe(10);
  });

  it("does not truncate content under the default limit", async () => {
    const content = "Hello world";
    mockFetch(`<html><body>${content}</body></html>`);
    const result = await fetchBodyForUrl("https://example.com");
    expect(result).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// 7. createACO integration
// ---------------------------------------------------------------------------

describe("createACO — url integration", () => {
  it("throws ValidationError when both url and body are provided", async () => {
    await expect(createACO({ url: "https://example.com", body: "manual body", author: AUTHOR })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("throws ValidationError (not degrades) for SSRF url", async () => {
    await expect(createACO({ url: "https://localhost/secret", author: AUTHOR })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("sets source_type to 'link' and source_url when url fetch succeeds", async () => {
    mockFetch("<html><body><article>Content here</article></body></html>");
    const aco = await createACO({ url: "https://example.com", author: AUTHOR });
    expect(aco.frontmatter["source_type"]).toBe("link");
    expect(aco.frontmatter["source_url"]).toBe("https://example.com");
    expect((aco.frontmatter["fetch_status"] as { ok: boolean }).ok).toBe(true);
    expect(aco.body).toContain("Content here");
  });

  it("preserves explicit source_type when url is provided", async () => {
    mockFetch("<html><body><article>Content</article></body></html>");
    const aco = await createACO({
      url: "https://example.com",
      source_type: "selected_text",
      author: AUTHOR,
    });
    expect(aco.frontmatter["source_type"]).toBe("selected_text");
  });

  it("does not overwrite source_url already in params.frontmatter", async () => {
    mockFetch("<html><body><article>Content</article></body></html>");
    const aco = await createACO({
      url: "https://example.com",
      author: AUTHOR,
      frontmatter: { source_url: "https://original.com" },
    });
    expect(aco.frontmatter["source_url"]).toBe("https://original.com");
  });

  it("degrades gracefully on 404: returns ACO with synthesised body and fetch_status", async () => {
    mockFetch("Not Found", 404);
    const aco = await createACO({
      url: "https://example.com/gone",
      title: "Gone Page",
      author: AUTHOR,
    });
    const status = aco.frontmatter["fetch_status"] as { ok: boolean; permanent: boolean; networkCode: string };
    expect(status.ok).toBe(false);
    expect(status.permanent).toBe(true);
    expect(status.networkCode).toBe("HTTP_404");
    expect(aco.body).toContain("https://example.com/gone");
    expect(aco.body).toContain("Gone Page");
  });

  it("degrades gracefully on 503: fetch_status.permanent is false", async () => {
    mockFetch("Unavailable", 503);
    const aco = await createACO({
      url: "https://example.com",
      author: AUTHOR,
    });
    const status = aco.frontmatter["fetch_status"] as { ok: boolean; permanent: boolean; networkCode: string };
    expect(status.ok).toBe(false);
    expect(status.permanent).toBe(false);
    expect(status.networkCode).toBe("HTTP_503");
  });

  it("degrades gracefully on ENOTFOUND: fetch_status.permanent is true, networkCode set", async () => {
    mockNetworkError("ENOTFOUND");
    const aco = await createACO({
      url: "https://example.com",
      author: AUTHOR,
    });
    const status = aco.frontmatter["fetch_status"] as { ok: boolean; permanent: boolean; networkCode: string };
    expect(status.ok).toBe(false);
    expect(status.permanent).toBe(true);
    expect(status.networkCode).toBe("ENOTFOUND");
  });

  it("fetch_status always wins over caller-supplied frontmatter value", async () => {
    mockFetch("<html><body><article>Content</article></body></html>");
    const aco = await createACO({
      url: "https://example.com",
      author: AUTHOR,
      frontmatter: { fetch_status: "caller-override-attempt" },
    });
    // SDK-generated fetch_status should win
    const status = aco.frontmatter["fetch_status"] as { ok: boolean };
    expect(typeof status).toBe("object");
    expect(status.ok).toBe(true);
  });

  it("does not set fetch_status for body-only ACOs", async () => {
    const aco = await createACO({ body: "manual content", author: AUTHOR });
    expect(aco.frontmatter["fetch_status"]).toBeUndefined();
    expect(aco.frontmatter["source_url"]).toBeUndefined();
  });

  it("existing body-only callers are unaffected", async () => {
    const aco = await createACO({ body: "hello", author: AUTHOR });
    expect(aco.body).toBe("hello");
    expect(aco.frontmatter["source_type"]).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// isBlockedAddress — range table
// ---------------------------------------------------------------------------

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.0.1",
    "fc00::1",
    "fdff::1",
    "fe80::1",
    "febf::1",
    "ff02::1",
    "2001:db8::1",
    "64:ff9b::a00:1",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001:80b::200e",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it("treats non-IP strings as blocked", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchPageForUrl — metadata
// ---------------------------------------------------------------------------

describe("fetchPageForUrl", () => {
  it("returns text plus og:title, og:image and description", async () => {
    mockFetch(`<html><head>
      <title>Fallback &amp; Title</title>
      <meta property="og:title" content="OG Title" />
      <meta property="og:image" content="https://cdn.example.com/img.png" />
      <meta name="description" content="A &quot;desc&quot;" />
    </head><body><article><p>Hello there</p></article></body></html>`);
    const page = await fetchPageForUrl("https://example.com/a");
    expect(page.text).toBe("Hello there");
    expect(page.title).toBe("OG Title");
    expect(page.ogImage).toBe("https://cdn.example.com/img.png");
    expect(page.description).toBe('A "desc"');
    expect(page.url).toBe("https://example.com/a");
  });

  it("falls back to <title> and omits absent metadata", async () => {
    mockFetch("<html><head><title>Only &amp; Title</title></head><body><p>x y</p></body></html>");
    const page = await fetchPageForUrl("https://example.com/b");
    expect(page.title).toBe("Only & Title");
    expect(page).not.toHaveProperty("ogImage");
    expect(page).not.toHaveProperty("description");
  });

  it("fetchBodyForUrl returns the same text", async () => {
    mockFetch("<html><body><main>same text</main></body></html>");
    expect(await fetchBodyForUrl("https://example.com/c")).toBe("same text");
  });
});

// ---------------------------------------------------------------------------
// Adversarial HTML — extraction must stay linear
// ---------------------------------------------------------------------------

describe("fetchPageForUrl — adversarial HTML stays fast", () => {
  const time = async (html: string) => {
    mockFetch(html);
    const t0 = performance.now();
    await fetchPageForUrl("https://example.com/adv");
    return performance.now() - t0;
  };

  it("100k unclosed <script> tags", async () => {
    expect(await time("<script>".repeat(100_000) + "<p>x</p>")).toBeLessThan(1_500);
  });

  it("20k <meta tags plus filler", async () => {
    expect(await time("<meta ".repeat(20_000) + "x".repeat(200_000))).toBeLessThan(1_500);
  });

  it("30k unterminated og:title meta tags", async () => {
    expect(await time('<meta property="og:title" '.repeat(30_000))).toBeLessThan(1_500);
  });

  it("still extracts real metadata and text after the rewrite", async () => {
    mockFetch(`<html><head><title>T</title><meta content="OG" property='og:title'><meta name=description content="D"></head>
      <body><nav>menu</nav><navigation-menu>keep</navigation-menu><script>var x = "<p>not text</p>";</script><article><h1>Hi</h1><p>Body &amp; text</p></article><footer>f</footer></body></html>`);
    const page = await fetchPageForUrl("https://example.com/ok");
    expect(page.title).toBe("OG");
    expect(page.description).toBe("D");
    expect(page.text).toBe("Hi Body &amp; text"); // article zone wins; <navigation-menu> is not <nav>
  });
});

describe("isBlockedAddress — additional IPv6 embeddings", () => {
  it.each([
    "::7f00:1",
    "::a00:1",
    "2002:7f00:1::",
    "2002:a00:1::1",
    "2001:0:53aa:64c:0:1:2:3",
    "100::1",
    "64:ff9b:1::1",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it.each(["2002:801:801::", "2001:4860:4860::8888", "64:ff9b:2::1"])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Redirects — followed, but every hop re-validated
// ---------------------------------------------------------------------------

/** Mock a redirect chain: each entry is a Location, the last entry is the final HTML page. */
function mockChain(
  hops: Array<{ status?: number; location?: string; html?: string; headers?: Record<string, string> }>
) {
  const seen: string[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      seen.push(url);
      const hop = hops[Math.min(i, hops.length - 1)];
      i++;
      if (hop?.location) {
        return Promise.resolve({
          ok: false,
          status: hop.status ?? 308,
          headers: { get: (h: string) => (h.toLowerCase() === "location" ? hop.location : null) },
          body: null,
          text: async () => "",
        });
      }
      const headers = hop?.headers ?? { "content-type": "text/html" };
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
        body: null,
        text: async () => hop?.html ?? "<html><body><p>done</p></body></html>",
      });
    })
  );
  return seen;
}

describe("fetchPageForUrl — redirects", () => {
  it("follows a redirect and reports the final URL", async () => {
    const seen = mockChain([
      { location: "https://example.com/moved" },
      { html: "<html><head><title>Moved</title></head><body><p>final</p></body></html>" },
    ]);
    const page = await fetchPageForUrl("https://example.com/start");
    expect(page.text).toBe("final");
    expect(page.title).toBe("Moved");
    expect(page.url).toBe("https://example.com/moved");
    expect(seen).toEqual(["https://example.com/start", "https://example.com/moved"]);
  });

  it("resolves a relative Location against the current URL", async () => {
    const seen = mockChain([{ location: "/docs/intro" }, { html: "<html><body><p>ok</p></body></html>" }]);
    const page = await fetchPageForUrl("https://example.com/a/b");
    expect(seen[1]).toBe("https://example.com/docs/intro");
    expect(page.url).toBe("https://example.com/docs/intro");
  });

  it.each([301, 302, 303, 307, 308])("follows a %i", async (status) => {
    mockChain([{ status, location: "https://example.com/final" }, { html: "<html><body><p>x</p></body></html>" }]);
    expect((await fetchPageForUrl("https://example.com/s")).url).toBe("https://example.com/final");
  });

  it("refuses a redirect to a private address (open-redirect SSRF)", async () => {
    mockChain([{ location: "https://169.254.169.254/latest/meta-data/" }]);
    await expect(fetchPageForUrl("https://example.com/evil")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a redirect that downgrades to http", async () => {
    mockChain([{ location: "http://example.com/insecure" }]);
    await expect(fetchPageForUrl("https://example.com/s")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a redirect to a hostname that resolves to a private IP", async () => {
    mockChain([{ location: "https://internal.example.com/x" }]);
    dnsLookup.mockImplementation(async (host: string) =>
      host === "internal.example.com" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]
    );
    await expect(fetchPageForUrl("https://example.com/s")).rejects.toBeInstanceOf(ValidationError);
  });

  it("gives up after too many hops", async () => {
    mockChain([{ location: "https://example.com/loop" }]);
    const err = await fetchPageForUrl("https://example.com/loop").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).networkCode).toBe("TOO_MANY_REDIRECTS");
  });

  it("rejects an unparseable Location", async () => {
    mockChain([{ location: "http://[::bad::]/x" }]);
    const err = await fetchPageForUrl("https://example.com/s").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).networkCode).toBe("INVALID_REDIRECT");
  });

  it("treats a 3xx without a Location header as the final response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: { get: () => null },
        body: null,
        text: async () => "",
      })
    );
    const err = await fetchPageForUrl("https://example.com/s").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).networkCode).toBe("HTTP_302");
  });
});
