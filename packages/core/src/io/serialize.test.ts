import { describe, expect, it } from "vitest";
import { parseACO, parseAndValidateACO } from "./parse.js";
import { serializeACO } from "./serialize.js";
import { yamlEngine } from "./yaml-engine.js";

const FM = {
  id: "0193f5e6-0000-7000-8000-000000000001",
  acp_version: "0.2",
  object_type: "aco",
  source_type: "manual",
  created: "2026-01-01T00:00:00Z",
  author: { id: "u", name: "U" },
  title: "T",
};

describe("serializeACO", () => {
  it("always ends with exactly one newline", () => {
    expect(serializeACO(FM, "body")).toMatch(/[^\n]\n$/);
    expect(serializeACO(FM, "body\n")).toMatch(/[^\n]\n$/);
    expect(serializeACO(FM, "body\n\n\n")).toMatch(/[^\n]\n$/);
    expect(serializeACO(FM, "")).toMatch(/---\n$/);
  });

  it.each([
    "hello",
    "line one\nline two",
    "trailing spaces   ",
    "# Title\n\nParagraph.\n\n- a\n- b",
    "\nleading newline",
    "",
  ])("round-trips body %j byte-for-byte", (body) => {
    const parsed = parseACO(serializeACO(FM, body));
    expect(parsed.body).toBe(body);
    expect(parsed.frontmatter).toEqual(FM);
  });

  it("is stable across repeated cycles", () => {
    let file = serializeACO(FM, "content");
    for (let i = 0; i < 5; i++) {
      const p = parseACO(file);
      file = serializeACO(p.frontmatter, p.body);
    }
    expect(parseACO(file).body).toBe("content");
  });

  it("keeps dates, booleans-as-strings and numbers exactly", () => {
    const fm = { ...FM, created: "2026-01-01", flag: "yes", n: 7, list: ["a", "b"], nested: { k: "v" } };
    const parsed = parseACO(serializeACO(fm, "x"));
    expect(parsed.frontmatter).toEqual(fm);
  });

  it("does not fold long lines", () => {
    const url = "https://example.com/" + "a".repeat(300);
    expect(serializeACO({ ...FM, source_url: url }, "x")).toContain(url);
  });
});

describe("yamlEngine", () => {
  it("returns an empty object for non-mapping YAML", () => {
    expect(yamlEngine.parse("- a\n- b")).toEqual({});
    expect(yamlEngine.parse("just a string")).toEqual({});
    expect(yamlEngine.parse("")).toEqual({});
  });
});

describe("parseAndValidateACO", () => {
  it("narrows on valid", () => {
    const r = parseAndValidateACO(serializeACO(FM, "x"));
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.frontmatter.title).toBe("T");
  });
  it("reports errors on invalid", () => {
    const r = parseAndValidateACO("---\nid: x\n---\nbody");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]?.issues.length).toBeGreaterThan(0);
  });
});
