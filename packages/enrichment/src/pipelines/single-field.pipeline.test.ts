import type { ACO } from "@atomic-content-protocol/core";
import { describe, expect, it } from "vitest";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import { ClassificationPipeline } from "./classification.pipeline.js";
import { EntityPipeline } from "./entity.pipeline.js";
import { extractJsonArray, hasValue, resolveModality } from "./single-field.pipeline.js";
import { SummaryPipeline } from "./summary.pipeline.js";

function provider(response: string, model = "mock-model"): IEnrichmentProvider {
  return {
    name: "mock",
    model,
    complete: async () => response,
    structuredComplete: async () => ({}) as never,
  };
}

function aco(fm: Record<string, unknown> = {}): ACO {
  return { frontmatter: { id: "t", title: "Title", ...fm }, body: "Body about ACP and Pinecone." };
}

describe("hasValue", () => {
  it.each([
    [undefined, false],
    [null, false],
    ["", false],
    ["  ", false],
    [[], false],
    [{}, false],
    ["x", true],
    [["a"], true],
    [{ a: 1 }, true],
    [0, true],
    [false, true],
  ])("hasValue(%j) → %s", (v, expected) => {
    expect(hasValue(v)).toBe(expected);
  });
});

describe("extractJsonArray", () => {
  it("parses a bare array", () => expect(extractJsonArray('["a"]')).toEqual(["a"]));
  it("parses inside prose and fences", () => {
    expect(extractJsonArray('Sure! ```json\n["a","b"]\n``` done')).toEqual(["a", "b"]);
  });
  it("handles ] inside strings", () => {
    expect(extractJsonArray('[{"name":"C[1]"},{"name":"D"}]')).toEqual([{ name: "C[1]" }, { name: "D" }]);
  });
  it("returns null when no array is present or parseable", () => {
    expect(extractJsonArray("nothing")).toBeNull();
    expect(extractJsonArray("[unclosed")).toBeNull();
    expect(extractJsonArray('{"a":1}')).toBeNull();
  });
});

describe("resolveModality", () => {
  it("maps source types and defaults to text", () => {
    expect(resolveModality({ source_type: "uploaded_image" })).toBe("image");
    expect(resolveModality({ source_type: "converted_video" })).toBe("video");
    expect(resolveModality({ source_type: "manual" })).toBe("text");
    expect(resolveModality({ source_type: "bogus" })).toBe("text");
    expect(resolveModality({})).toBe("text");
  });
});

describe("SummaryPipeline", () => {
  const p = new SummaryPipeline();
  it("writes a trimmed, whitespace-collapsed summary capped at 500 chars with provenance", async () => {
    const r = await p.enrich(aco(), provider("  A   long\n summary.  " + "x".repeat(600)));
    const summary = r.aco.frontmatter["summary"] as string;
    expect(summary.startsWith("A long summary.")).toBe(true);
    expect(summary.length).toBe(500);
    const prov = r.aco.frontmatter["provenance"] as Record<string, Record<string, unknown>>;
    expect(prov["summary"]!["model"]).toBe("mock-model");
    expect(prov["summary"]!["pipeline"]).toBe("summary");
  });
  it("skips a human-authored summary", async () => {
    const r = await p.enrich(aco({ summary: "mine" }), provider("ai"));
    expect(r.aco.frontmatter["summary"]).toBe("mine");
    expect(r.model).toBe("skipped");
  });
  it("leaves the ACO untouched on an empty response", async () => {
    const r = await p.enrich(aco(), provider("   "));
    expect(r.aco.frontmatter["summary"]).toBeUndefined();
    expect(r.aco.frontmatter["provenance"]).toBeUndefined();
  });
  it("uses completeWithMeta for model attribution", async () => {
    const pr: IEnrichmentProvider = {
      ...provider("s"),
      completeWithMeta: async () => ({ result: "meta summary", provider: "p2", model: "p2-model" }),
    };
    const r = await p.enrich(aco(), pr);
    expect(r.model).toBe("p2-model");
    expect(r.aco.frontmatter["summary"]).toBe("meta summary");
  });
});

describe("EntityPipeline", () => {
  const p = new EntityPipeline();
  it("sanitises entities: type fallback, confidence clamp, drops empty names", async () => {
    const r = await p.enrich(
      aco(),
      provider(
        '[{"type":"Technology","name":"ACP","confidence":1.7},{"type":"weird","name":"X","confidence":"n"},{"type":"person","name":"  "}]'
      )
    );
    expect(r.aco.frontmatter["key_entities"]).toEqual([
      { type: "technology", name: "ACP", confidence: 1 },
      { type: "concept", name: "X", confidence: 0.5 },
    ]);
  });
  it("returns unchanged when nothing usable is extracted", async () => {
    const r = await p.enrich(aco(), provider('[{"name":""}]'));
    expect(r.aco.frontmatter["key_entities"]).toBeUndefined();
    expect(r.aco.frontmatter["provenance"]).toBeUndefined();
  });
});

describe("ClassificationPipeline", () => {
  const p = new ClassificationPipeline();
  it("classifies text via the model and normalises punctuation", async () => {
    const r = await p.enrich(aco(), provider("Tutorial."));
    expect(r.aco.frontmatter["classification"]).toBe("tutorial");
    expect(r.confidence).toBe(0.85);
  });
  it("falls back to other with lower confidence", async () => {
    const r = await p.enrich(aco(), provider("poem about clouds"));
    expect(r.aco.frontmatter["classification"]).toBe("other");
    expect(r.confidence).toBe(0.5);
  });
  it("classifies image/video ACOs deterministically without calling the model", async () => {
    let calls = 0;
    const pr: IEnrichmentProvider = {
      ...provider(""),
      complete: async () => {
        calls++;
        return "notes";
      },
    };
    const r = await p.enrich(aco({ source_type: "uploaded_image" }), pr);
    expect(r.aco.frontmatter["classification"]).toBe("image");
    expect(calls).toBe(0);
    const prov = r.aco.frontmatter["provenance"] as Record<string, Record<string, unknown>>;
    expect(prov["classification"]!["model"]).toBe("system");
  });
});
