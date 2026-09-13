import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies safe defaults", () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: "k" });
    expect(c.trustProxy).toBe(1);
    expect(c.rateLimitPerHour).toBe(50);
    expect(c.apiKeys).toEqual([]);
    expect(c.corsOrigins).toEqual([]);
    expect(c.dailyCostCapUsd).toBe(Number.POSITIVE_INFINITY);
    expect(c.quality).toBe("fast");
    expect(c.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("parses lists, numbers and booleans", () => {
    const c = loadConfig({
      MCP_API_KEYS: " a , b ,",
      CORS_ORIGINS: "https://x.org",
      TRUST_PROXY: "true",
      DAILY_COST_CAP_USD: "2.5",
      ENRICHMENT_QUALITY: "best",
      RATE_LIMIT_PER_HOUR: "7",
    });
    expect(c.apiKeys).toEqual(["a", "b"]);
    expect(c.corsOrigins).toEqual(["https://x.org"]);
    expect(c.trustProxy).toBe(true);
    expect(c.dailyCostCapUsd).toBe(2.5);
    expect(c.quality).toBe("best");
    expect(c.rateLimitPerHour).toBe(7);
  });

  it("rejects invalid values loudly", () => {
    expect(() => loadConfig({ ENRICHMENT_QUALITY: "turbo" })).toThrow(/ENRICHMENT_QUALITY/);
    expect(() => loadConfig({ RATE_LIMIT_PER_HOUR: "lots" })).toThrow(/RATE_LIMIT_PER_HOUR/);
    expect(() => loadConfig({ TRUST_PROXY: "maybe" })).toThrow(/TRUST_PROXY/);
  });
});
