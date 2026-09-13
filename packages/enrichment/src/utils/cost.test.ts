import { describe, it, expect } from "vitest";
import { estimateEnrichmentCost, formatCostEstimate } from "./cost.js";
import { MODEL_PRICING, MODEL_PRESETS } from "../providers/models.js";

describe("estimateEnrichmentCost", () => {
  const content = "word ".repeat(1_000); // 5 000 chars → 1 250 approximate tokens

  it("prices every preset model and headlines Haiku 4.5 by default", () => {
    const est = estimateEnrichmentCost(content);
    expect(est.model).toBe("claude-haiku-4-5");
    for (const tier of Object.values(MODEL_PRESETS)) {
      expect(est.estimatedCost[tier.anthropic]).toBeGreaterThan(0);
      expect(est.estimatedCost[tier.openai]).toBeGreaterThan(0);
    }
    expect(est.cost).toBe(est.estimatedCost["claude-haiku-4-5"]);
  });

  it("uses current Haiku 4.5 list prices ($1 / $5 per MTok)", () => {
    const est = estimateEnrichmentCost(content, "standard");
    const rates = MODEL_PRICING["claude-haiku-4-5"]!;
    expect(rates).toEqual({ input: 1.0, output: 5.0 });
    const expected = (est.inputTokens * rates.input + est.outputTokens * rates.output) / 1_000_000;
    expect(est.cost).toBeCloseTo(expected, 10);
  });

  it("only counts the body that is actually sent to the model", () => {
    const short = estimateEnrichmentCost("x".repeat(4_000));
    const long = estimateEnrichmentCost("x".repeat(400_000));
    expect(long.inputTokens).toBe(short.inputTokens);
    expect(long.contentTokens).toBeGreaterThan(short.contentTokens);
  });

  it("headlines a requested model or tier", () => {
    expect(estimateEnrichmentCost(content, "standard", { model: "gpt-5.6-sol" }).model).toBe("gpt-5.6-sol");
    expect(estimateEnrichmentCost(content, "standard", { quality: "best" }).model).toBe("claude-opus-5");
  });

  it("falls back to the default price when the model is unknown", () => {
    const est = estimateEnrichmentCost(content, "standard", { model: "mystery-9000" });
    expect(est.model).toBe("mystery-9000");
    expect(est.cost).toBe(est.estimatedCost["claude-haiku-4-5"]);
  });

  it("depth changes output token and frontmatter estimates", () => {
    expect(estimateEnrichmentCost(content, "deep").outputTokens).toBeGreaterThan(
      estimateEnrichmentCost(content, "basic").outputTokens
    );
  });

  it("break-even is finite for long content and N/A for tiny content", () => {
    expect(estimateEnrichmentCost(content).breakEvenReads).toBeGreaterThan(0);
    expect(estimateEnrichmentCost("tiny").breakEvenReads).toBe(Infinity);
    expect(formatCostEstimate(estimateEnrichmentCost("tiny"))).toContain("N/A");
  });
});
