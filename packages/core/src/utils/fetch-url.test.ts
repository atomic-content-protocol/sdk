import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchBodyForUrl } from "./fetch-url.js";
import { ValidationError, FetchError } from "./errors.js";
import { createACO } from "../index.js";

const AUTHOR = { id: "test", name: "Test" };

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

function mockNetworkError(code: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(Object.assign(new Error(`mock: ${code}`), { code }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. SSRF validation
// ---------------------------------------------------------------------------

describe("fetchBodyForUrl — SSRF validation", () => {
  it("throws ValidationError for http:// URL", async () => {
    await expect(fetchBodyForUrl("http://example.com")).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("throws ValidationError for ftp:// URL", async () => {
    await expect(fetchBodyForUrl("ftp://example.com/file")).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("throws ValidationError for a non-parseable string", async () => {
    await expect(fetchBodyForUrl("not-a-url")).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("throws ValidationError for localhost", async () => {
    await expect(
      fetchBodyForUrl("https://localhost/anything")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 127.0.0.1", async () => {
    await expect(
      fetchBodyForUrl("https://127.0.0.1/")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for ::1 (IPv6 loopback)", async () => {
    await expect(
      fetchBodyForUrl("https://[::1]/")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 169.254.x.x (link-local)", async () => {
    await expect(
      fetchBodyForUrl("https://169.254.169.254/latest/meta-data")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 10.x.x.x (RFC 1918 class A)", async () => {
    await expect(
      fetchBodyForUrl("https://10.0.0.1/admin")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 192.168.x.x (RFC 1918 class C)", async () => {
    await expect(
      fetchBodyForUrl("https://192.168.1.50/")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 172.16.x.x (RFC 1918 class B)", async () => {
    await expect(
      fetchBodyForUrl("https://172.16.0.1/")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for 172.31.x.x (RFC 1918 class B upper)", async () => {
    await expect(
      fetchBodyForUrl("https://172.31.255.255/")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does NOT block 172.15.x.x (just outside RFC 1918 range)", async () => {
    mockFetch("<html><body>ok</body></html>");
    // Should not throw ValidationError (may throw FetchError from mock, but not SSRF)
    const err = await fetchBodyForUrl("https://172.15.0.1/").catch((e) => e);
    expect(err).not.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for *.local domain", async () => {
    await expect(
      fetchBodyForUrl("https://my-service.local/")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for *.internal domain", async () => {
    await expect(
      fetchBodyForUrl("https://api.server.internal/")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError for metadata.google.internal", async () => {
    await expect(
      fetchBodyForUrl("https://metadata.google.internal/")
    ).rejects.toBeInstanceOf(ValidationError);
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

  it("redirect refusal → FetchError with permanent: false (no networkCode)", async () => {
    // Simulate what happens when redirect: "error" causes fetch to throw
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new TypeError("fetch failed")
    ));
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
    await expect(
      createACO({ url: "https://example.com", body: "manual body", author: AUTHOR })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError (not degrades) for SSRF url", async () => {
    await expect(
      createACO({ url: "https://localhost/secret", author: AUTHOR })
    ).rejects.toBeInstanceOf(ValidationError);
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
