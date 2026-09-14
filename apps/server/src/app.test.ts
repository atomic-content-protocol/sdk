import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { IEnrichmentProvider } from "@atomic-content-protocol/enrichment";
import { ProviderRouter } from "@atomic-content-protocol/enrichment";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { requestWeight } from "./mcp-handler.js";
import { toolCallWeight } from "./tools.js";

// ---------------------------------------------------------------------------
// Fake provider — deterministic structured output, no network
// ---------------------------------------------------------------------------

const OUTPUT = {
  tags: ["alpha", "beta"],
  summary: "A summary. Another sentence.",
  classification: "notes",
  key_entities: [{ type: "concept", name: "Alpha", confidence: 0.9 }],
  language: "en",
};

function fakeProvider(): IEnrichmentProvider & { calls: number } {
  const p = {
    name: "Fake/fake-model",
    model: "fake-model",
    calls: 0,
    complete: async () => "",
    structuredComplete: async <T>() => {
      p.calls++;
      return OUTPUT as unknown as T;
    },
  };
  return p;
}

const provider = fakeProvider();
let http: Server;
let base: string;

const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

function rpc(method: string, params: unknown, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

async function post(body: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { ...HEADERS, ...extra },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, text };
}

/** Streamable HTTP may answer as SSE; pull the JSON out of either form. */
function parseRpc(text: string): any {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text);
}

async function callTool(name: string, args: unknown, extra: Record<string, string> = {}) {
  const { res, text } = await post(rpc("tools/call", { name, arguments: args }), extra);
  if (res.status !== 200) return { res, rpc: null as any, tool: null as any };
  const parsed = parseRpc(text);
  const tool = parsed.result?.content?.[0]?.text ? JSON.parse(parsed.result.content[0].text) : null;
  return { res, rpc: parsed, tool };
}

beforeAll(async () => {
  const config = loadConfig({
    ANTHROPIC_API_KEY: "test",
    RATE_LIMIT_PER_HOUR: "6",
    TRUST_PROXY: "1",
    CORS_ORIGINS: "https://allowed.example",
    DAILY_COST_CAP_USD: "0.005",
    MAX_CONTENT_LENGTH: "2000",
  });
  const router = new ProviderRouter([provider]);
  const app = createApp(config, { router, log: () => {} });
  await new Promise<void>((resolve) => {
    http = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

describe("weights", () => {
  it("handshake is free, tool calls cost 1, batches cost item count", () => {
    expect(requestWeight(rpc("initialize", {}))).toBe(0);
    expect(requestWeight(rpc("tools/list", {}))).toBe(0);
    expect(requestWeight(rpc("tools/call", { name: "enrich_content", arguments: {} }))).toBe(1);
    expect(toolCallWeight("enrich_batch", { items: [1, 2, 3] })).toBe(3);
    expect(toolCallWeight("enrich_batch", { items: new Array(50).fill(0) })).toBe(10);
    expect(
      requestWeight([
        rpc("tools/call", { name: "enrich_content" }),
        rpc("tools/call", { name: "enrich_batch", arguments: { items: [1, 2] } }),
      ])
    ).toBe(3);
  });
});

describe("HTTP surface", () => {
  it("GET /health reports config", async () => {
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as Record<string, any>;
    expect(body.status).toBe("ok");
    expect(body.providers.anthropic).toBe(true);
    expect(body.quality).toBe("fast");
    expect(body.daily_cost_cap_usd).toBe(0.005);
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("tools/list returns the three tools without a $schema key and does not consume rate limit", async () => {
    const { res, text } = await post(rpc("tools/list", {}));
    expect(res.status).toBe(200);
    const parsed = parseRpc(text);
    const names = parsed.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["enrich_batch", "enrich_content", "enrich_url"]);
    for (const t of parsed.result.tools) expect(t.inputSchema).not.toHaveProperty("$schema");
    expect(res.headers.get("ratelimit-remaining")).toBe("6");
  });

  it("CORS: allowed origin echoed, unknown origin gets no allow header", async () => {
    const ok = await fetch(`${base}/health`, { headers: { Origin: "https://allowed.example" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    const nope = await fetch(`${base}/health`, { headers: { Origin: "https://evil.example" } });
    expect(nope.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects oversized and malformed bodies cleanly", async () => {
    const big = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ x: "y".repeat(200_000) }),
    });
    expect(big.status).toBe(413);
    const bad = await fetch(`${base}/mcp`, { method: "POST", headers: HEADERS, body: "{not json" });
    expect(bad.status).toBe(400);
  });

  it("DELETE /mcp is 405 in stateless mode", async () => {
    expect((await fetch(`${base}/mcp`, { method: "DELETE" })).status).toBe(405);
  });
});

describe("tool calls", () => {
  it("enrich_content returns validated enriched frontmatter and truthful model", async () => {
    const { res, tool } = await callTool(
      "enrich_content",
      { content: "Alpha and beta are concepts.", title: "T" },
      { "X-Forwarded-For": "10.9.9.1" }
    );
    expect(res.status).toBe(200);
    expect(tool.success).toBe(true);
    expect(tool.data.aco.tags).toEqual(["alpha", "beta"]);
    expect(tool.data.aco.provenance.tags.model).toBe("fake-model");
    expect(tool.data.aco.provenance.tags.tool).toMatch(/^acp-hosted-mcp@/);
    expect(tool.data.cost.model).toBe("fake-model");
    expect(tool.data.cost.estimated).toBeGreaterThan(0);
  });

  it("unknown tool → JSON-RPC method-not-found error", async () => {
    const { rpc: parsed } = await callTool("nope", {}, { "X-Forwarded-For": "10.9.9.2" });
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32601);
  });

  it("invalid input → isError with INVALID_INPUT, never a stack trace", async () => {
    const { rpc: parsed, tool } = await callTool("enrich_content", { content: 42 }, { "X-Forwarded-For": "10.9.9.3" });
    expect(parsed.result.isError).toBe(true);
    expect(tool.code).toBe("INVALID_INPUT");
  });

  it("enrich_url refuses private and non-HTTPS targets without fetching", async () => {
    for (const url of ["http://example.com", "https://169.254.169.254/latest", "https://localhost/x"]) {
      const { tool } = await callTool("enrich_url", { url }, { "X-Forwarded-For": "10.9.9.4" });
      expect(tool.success).toBe(false);
      expect(tool.code).toBe("INVALID_URL");
    }
  });

  it("content over the limit is rejected", async () => {
    const { tool } = await callTool("enrich_content", { content: "x".repeat(2001) }, { "X-Forwarded-For": "10.9.9.5" });
    expect(tool.code).toBe("CONTENT_TOO_LARGE");
  });

  it("enrich_batch mixes results and per-item errors", async () => {
    const { tool } = await callTool(
      "enrich_batch",
      { items: [{ content: "good content here" }, { url: "https://127.0.0.1/" }, { content: "" }] },
      { "X-Forwarded-For": "10.9.9.6" }
    );
    expect(tool.success).toBe(true);
    expect(tool.data.items).toHaveLength(1);
    expect(tool.data.errors.map((e: any) => [e.index, e.code])).toEqual([
      [1, "INVALID_URL"],
      [2, "EMPTY_CONTENT"],
    ]);
  });
});

describe("abuse controls", () => {
  it("rate limits per forwarded client IP, weighted by batch size", async () => {
    const ip = { "X-Forwarded-For": "203.0.113.77" };
    const first = await post(rpc("tools/call", { name: "enrich_content", arguments: { content: "a b c" } }), ip);
    expect(first.res.headers.get("ratelimit-remaining")).toBe("5");
    // A 6-item batch does not fit into 5 remaining units → 429 and nothing consumed.
    const batch = await post(
      rpc("tools/call", { name: "enrich_batch", arguments: { items: new Array(6).fill({ content: "x y" }) } }),
      ip
    );
    expect(batch.res.status).toBe(429);
    expect(batch.res.headers.get("retry-after")).toBeTruthy();
    expect((await post(rpc("tools/list", {}), ip)).res.headers.get("ratelimit-remaining")).toBe("5");
    // Another client is unaffected.
    const other = await post(rpc("tools/list", {}), { "X-Forwarded-For": "203.0.113.78" });
    expect(other.res.headers.get("ratelimit-remaining")).toBe("6");
  });

  it("daily spend cap stops enrichment with BUDGET_EXCEEDED", async () => {
    const ip = { "X-Forwarded-For": "198.51.100.5" };
    // Cap is $0.005; each call costs ~$0.002, so the third call trips it.
    let code: string | undefined;
    for (let i = 0; i < 6 && code !== "BUDGET_EXCEEDED"; i++) {
      const { tool, res } = await callTool("enrich_content", { content: "w ".repeat(900) }, ip);
      if (res.status === 429) break;
      code = tool?.code;
    }
    expect(code).toBe("BUDGET_EXCEEDED");
  });
});

describe("bearer auth", () => {
  let authHttp: Server;
  let authBase: string;
  beforeAll(async () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "test", MCP_API_KEYS: "secret-1,secret-2" });
    const app = createApp(config, { router: new ProviderRouter([fakeProvider()]), log: () => {} });
    await new Promise<void>((r) => {
      authHttp = app.listen(0, () => r());
    });
    authBase = `http://127.0.0.1:${(authHttp.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => authHttp.close(() => r()));
  });

  it("requires a valid bearer token when keys are configured", async () => {
    const body = JSON.stringify(rpc("tools/list", {}));
    expect((await fetch(`${authBase}/mcp`, { method: "POST", headers: HEADERS, body })).status).toBe(401);
    expect(
      (await fetch(`${authBase}/mcp`, { method: "POST", headers: { ...HEADERS, Authorization: "Bearer wrong" }, body }))
        .status
    ).toBe(401);
    expect(
      (
        await fetch(`${authBase}/mcp`, {
          method: "POST",
          headers: { ...HEADERS, Authorization: "Bearer secret-2" },
          body,
        })
      ).status
    ).toBe(200);
  });
});

describe("hardening (re-review)", () => {
  it("unsupported Content-Encoding gets a JSON 4xx, never an HTML stack trace", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Encoding": "br" },
      body: "x",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(await res.text()).not.toMatch(/at .*\.js:\d+/);
  });

  it("provider 401 maps to PROVIDER_AUTH, not retryable", async () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "bad", RATE_LIMIT_PER_HOUR: "5" });
    const failing: IEnrichmentProvider = {
      ...fakeProvider(),
      structuredComplete: async () => {
        throw Object.assign(new Error("authentication_error"), { status: 401 });
      },
    };
    const app = createApp(config, { router: new ProviderRouter([failing]), log: () => {} });
    const srv: Server = await new Promise((r) => {
      const h = app.listen(0, () => r(h));
    });
    try {
      const port = (srv.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(rpc("tools/call", { name: "enrich_content", arguments: { content: "hello world" } })),
      });
      const parsed = parseRpc(await res.text());
      const tool = JSON.parse(parsed.result.content[0].text);
      expect(tool.code).toBe("PROVIDER_AUTH");
      expect(tool.retryable).toBe(false);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it("loadConfig refuses to start without any provider key", () => {
    expect(() => loadConfig({})).toThrow(/No AI provider/);
  });
});

describe("bearer auth metering", () => {
  it("failed attempts consume rate-limit units per IP and eventually 429", async () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "test", MCP_API_KEYS: "secret-1", RATE_LIMIT_PER_HOUR: "2" });
    const app = createApp(config, { router: new ProviderRouter([fakeProvider()]), log: () => {} });
    const srv: Server = await new Promise((r) => {
      const h = app.listen(0, () => r(h));
    });
    try {
      const port = (srv.address() as AddressInfo).port;
      const body = JSON.stringify(rpc("tools/list", {}));
      const hit = () =>
        fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: { ...HEADERS, Authorization: "Bearer nope", "X-Forwarded-For": "203.0.113.200" },
          body,
        });
      expect((await hit()).status).toBe(401);
      expect((await hit()).status).toBe(401);
      expect((await hit()).status).toBe(429);
      // A valid key from the same IP is unaffected (keyed separately).
      const ok = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { ...HEADERS, Authorization: "Bearer secret-1", "X-Forwarded-For": "203.0.113.200" },
        body,
      });
      expect(ok.status).toBe(200);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
