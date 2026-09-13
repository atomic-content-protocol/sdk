import { describe, it, expect } from "vitest";
import { parseUnifiedOutput, buildUnifiedPrompt, UNIFIED_SCHEMA } from "./prompts.js";

describe("parseUnifiedOutput", () => {
  const valid = {
    tags: ["AI", "ai", " Protocol Design ", "knowledge"],
    summary: "  A   summary.  ",
    classification: "Reference",
    key_entities: [
      { type: "technology", name: "ACP", confidence: 0.95 },
      { type: "bogus", name: "  ", confidence: 2 },
      { type: "PERSON", name: "Ada", confidence: -1 },
    ],
    language: "EN",
  };

  it("normalises tags: lowercase, hyphenated, de-duplicated", () => {
    expect(parseUnifiedOutput(valid).tags).toEqual(["ai", "protocol-design", "knowledge"]);
  });

  it("caps tags at 20 and summary at 500 characters", () => {
    const out = parseUnifiedOutput({
      ...valid,
      tags: Array.from({ length: 40 }, (_, i) => `t${i}`),
      summary: "s".repeat(1_000),
    });
    expect(out.tags).toHaveLength(20);
    expect(out.summary).toHaveLength(500);
  });

  it("collapses whitespace in the summary", () => {
    expect(parseUnifiedOutput(valid).summary).toBe("A summary.");
  });

  it("maps unknown classifications to other and lower-cases known ones", () => {
    expect(parseUnifiedOutput(valid).classification).toBe("reference");
    expect(parseUnifiedOutput({ ...valid, classification: "poem" }).classification).toBe("other");
  });

  it("drops empty-name entities, clamps confidence, normalises types", () => {
    expect(parseUnifiedOutput(valid).key_entities).toEqual([
      { type: "technology", name: "ACP", confidence: 0.95 },
      { type: "person", name: "Ada", confidence: 0 },
    ]);
  });

  it("tolerates a malformed key_entities payload", () => {
    expect(parseUnifiedOutput({ ...valid, key_entities: "nope" }).key_entities).toEqual([]);
  });

  it("normalises language to ISO 639-1 or null", () => {
    expect(parseUnifiedOutput(valid).language).toBe("en");
    expect(parseUnifiedOutput({ ...valid, language: "en-US" }).language).toBe("en");
    expect(parseUnifiedOutput({ ...valid, language: "English" }).language).toBeNull();
    expect(parseUnifiedOutput({ ...valid, language: null }).language).toBeNull();
    expect(parseUnifiedOutput({ ...valid, language: 42 }).language).toBeNull();
  });

  it("throws a descriptive error when required fields are missing", () => {
    expect(() => parseUnifiedOutput({ tags: "x" })).toThrow(/failed validation/);
    expect(() => parseUnifiedOutput("a string")).toThrow(/failed validation/);
  });

  it("schema enums stay in sync with the JSON schema", () => {
    const enums = UNIFIED_SCHEMA.parameters.properties.classification.enum;
    for (const c of enums) {
      expect(parseUnifiedOutput({ ...valid, classification: c }).classification).toBe(c);
    }
  });
});

describe("buildUnifiedPrompt", () => {
  it("truncates long bodies", () => {
    const prompt = buildUnifiedPrompt("T", "x".repeat(10_000));
    expect(prompt.length).toBeLessThan(5_000);
  });

  it("emits media rules for image and video", () => {
    expect(buildUnifiedPrompt("pic.png", "", "image")).toMatch(/MUST be "image"/);
    expect(buildUnifiedPrompt("clip.mp4", "", "video")).toMatch(/MUST be "video"/);
  });
});
