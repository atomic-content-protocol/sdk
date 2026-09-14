import { describe, expect, it } from "vitest";
import { buildPipeline, isPipelineName, needsPipeline, PIPELINE_NAMES, pipelinesNeeded } from "./registry.js";

describe("pipeline registry", () => {
  it("builds every named pipeline with a matching name", () => {
    for (const name of PIPELINE_NAMES) {
      const p = buildPipeline(name);
      expect(typeof p.enrich).toBe("function");
      expect(p.name.startsWith(name === "entity" ? "entity" : name)).toBe(true);
    }
    expect(isPipelineName("unified")).toBe(true);
    expect(isPipelineName("bogus")).toBe(false);
  });

  it("needsPipeline mirrors idempotency (empty values need work, filled do not)", () => {
    const aco = {
      frontmatter: { tags: ["x"], summary: "", key_entities: [], classification: "notes", language: "en" },
      body: "",
    };
    expect(needsPipeline(aco, "tag")).toBe(false);
    expect(needsPipeline(aco, "summary")).toBe(true);
    expect(needsPipeline(aco, "entity")).toBe(true);
    expect(needsPipeline(aco, "classification")).toBe(false);
    expect(needsPipeline(aco, "unified")).toBe(true);
    expect(needsPipeline(aco, "embed")).toBe(true);
    expect(needsPipeline({ frontmatter: { provenance: { embedding: {} } }, body: "" }, "embed")).toBe(false);
  });

  it("pipelinesNeeded filters unless forced", () => {
    const full = {
      frontmatter: {
        tags: ["a"],
        summary: "s",
        key_entities: [{ name: "n" }],
        classification: "c",
        language: "en",
        provenance: { embedding: {} },
      },
      body: "",
    };
    expect(pipelinesNeeded(full, ["unified", "embed"])).toEqual([]);
    expect(pipelinesNeeded(full, ["unified", "embed"], true)).toEqual(["unified", "embed"]);
    expect(pipelinesNeeded({ frontmatter: {}, body: "" }, ["tag", "embed"])).toEqual(["tag", "embed"]);
  });
});
