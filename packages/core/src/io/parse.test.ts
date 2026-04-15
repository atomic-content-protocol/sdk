import { describe, it, expect } from "vitest";
import { parseACO, parseAndValidateACO } from "./parse.js";
import { serializeACO } from "./serialize.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_FRONTMATTER = {
  id: "0193f5e6-c5f0-7000-8000-000000000001",
  acp_version: "0.2",
  object_type: "aco",
  source_type: "manual",
  created: "2026-04-13T00:00:00Z",
  author: { id: "user-1", name: "Test Author" },
};

// Build a well-formed ACO file string directly for parse tests
function buildAcoFile(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const fmLines = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (typeof v === "object" && v !== null) {
        // Simple nested object rendering for tests
        const nested = Object.entries(v as Record<string, unknown>)
          .map(([nk, nv]) => `  ${nk}: ${JSON.stringify(nv)}`)
          .join("\n");
        return `${k}:\n${nested}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");
  return `---\n${fmLines}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseACO", () => {
  it("parses a file with YAML frontmatter and body", () => {
    const raw = buildAcoFile(VALID_FRONTMATTER, "# Hello\n\nContent body here.");
    const result = parseACO(raw);
    expect(result.frontmatter["id"]).toBe(VALID_FRONTMATTER.id);
    expect(result.body).toContain("Content body here.");
  });

  it("returns the raw file content unchanged in result.raw", () => {
    const raw = buildAcoFile(VALID_FRONTMATTER, "Some body.");
    const result = parseACO(raw);
    expect(result.raw).toBe(raw);
  });

  it("returns an empty frontmatter object for content with no YAML block", () => {
    const result = parseACO("Just plain text, no frontmatter.");
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Just plain text, no frontmatter.");
  });

  it("preserves body content exactly after the closing ---", () => {
    const body = "Line one.\nLine two.\n\nLine four.";
    const raw = buildAcoFile(VALID_FRONTMATTER, body);
    const result = parseACO(raw);
    expect(result.body.trim()).toBe(body.trim());
  });

  it("handles an empty body (frontmatter-only file)", () => {
    const raw = buildAcoFile(VALID_FRONTMATTER, "");
    const result = parseACO(raw);
    expect(result.body.trim()).toBe("");
  });

  it("does NOT convert ISO date strings to Date objects (JSON_SCHEMA prevents coercion)", () => {
    const raw = buildAcoFile(VALID_FRONTMATTER, "");
    const result = parseACO(raw);
    // created should remain a string, not a Date
    expect(typeof result.frontmatter["created"]).toBe("string");
    expect(result.frontmatter["created"]).toBe("2026-04-13T00:00:00Z");
  });

  it("parses boolean values correctly", () => {
    const fmWithBool = { ...VALID_FRONTMATTER, agent_accessible: true };
    const raw = buildAcoFile(fmWithBool, "");
    const result = parseACO(raw);
    expect(result.frontmatter["agent_accessible"]).toBe(true);
    expect(typeof result.frontmatter["agent_accessible"]).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe("parse / serialize round-trip", () => {
  it("parseACO(serializeACO(fm, body)) returns the same frontmatter and body", () => {
    const body = "# Round-trip test\n\nThis content should survive.";
    const serialized = serializeACO(VALID_FRONTMATTER, body);
    const result = parseACO(serialized);

    expect(result.frontmatter["id"]).toBe(VALID_FRONTMATTER.id);
    expect(result.frontmatter["acp_version"]).toBe(VALID_FRONTMATTER.acp_version);
    expect(result.frontmatter["object_type"]).toBe(VALID_FRONTMATTER.object_type);
    expect(result.frontmatter["source_type"]).toBe(VALID_FRONTMATTER.source_type);
    expect(result.frontmatter["created"]).toBe(VALID_FRONTMATTER.created);
    expect(result.body.trim()).toBe(body.trim());
  });

  it("round-trip preserves nested author fields", () => {
    const body = "body text";
    const serialized = serializeACO(VALID_FRONTMATTER, body);
    const result = parseACO(serialized);
    const author = result.frontmatter["author"] as Record<string, unknown>;
    expect(author["id"]).toBe("user-1");
    expect(author["name"]).toBe("Test Author");
  });

  it("round-trip preserves boolean agent_accessible value", () => {
    const fm = { ...VALID_FRONTMATTER, agent_accessible: true };
    const serialized = serializeACO(fm, "");
    const result = parseACO(serialized);
    expect(result.frontmatter["agent_accessible"]).toBe(true);
  });

  it("round-trip preserves tags array", () => {
    const fm = { ...VALID_FRONTMATTER, tags: ["ai", "protocol", "acp"] };
    const serialized = serializeACO(fm, "");
    const result = parseACO(serialized);
    expect(result.frontmatter["tags"]).toEqual(["ai", "protocol", "acp"]);
  });

  it("round-trip preserves ISO date strings as strings (no Date promotion)", () => {
    const fm = {
      ...VALID_FRONTMATTER,
      modified: "2026-04-13T12:00:00Z",
    };
    const serialized = serializeACO(fm, "");
    const result = parseACO(serialized);
    expect(typeof result.frontmatter["modified"]).toBe("string");
    expect(typeof result.frontmatter["created"]).toBe("string");
  });

  it("round-trip is lossless for null values", () => {
    const fm = { ...VALID_FRONTMATTER, expiration: null };
    const serialized = serializeACO(fm, "");
    const result = parseACO(serialized);
    expect(result.frontmatter["expiration"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateACO tests
// ---------------------------------------------------------------------------

describe("parseAndValidateACO", () => {
  it("returns valid:true for a file with valid frontmatter", () => {
    const raw = buildAcoFile(VALID_FRONTMATTER, "Some body content.");
    const result = parseAndValidateACO(raw);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeNull();
  });

  it("returns a typed ACOFrontmatter when valid", () => {
    const raw = buildAcoFile(VALID_FRONTMATTER, "Content.");
    const result = parseAndValidateACO(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      const fm = result.frontmatter as Record<string, unknown>;
      expect(fm["id"]).toBe(VALID_FRONTMATTER.id);
      expect(fm["object_type"]).toBe("aco");
    }
  });

  it("returns valid:false and errors for an invalid ACO (missing required fields)", () => {
    // Missing source_type, created, author
    const raw = `---\nid: "some-id"\nacp_version: "0.2"\nobject_type: "aco"\n---\nbody`;
    const result = parseAndValidateACO(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).not.toBeNull();
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("returns valid:false for invalid source_type enum value", () => {
    const invalidFm = { ...VALID_FRONTMATTER, source_type: "invalid-type" };
    const raw = buildAcoFile(invalidFm, "Body text.");
    const result = parseAndValidateACO(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).not.toBeNull();
  });

  it("returns body content regardless of validation outcome", () => {
    const raw = `---\nid: "x"\n---\nThis is the body.`;
    const result = parseAndValidateACO(raw);
    expect(result.body).toContain("This is the body.");
  });

  it("returns empty string body for frontmatter-only file", () => {
    const raw = buildAcoFile(VALID_FRONTMATTER, "");
    const result = parseAndValidateACO(raw);
    expect(result.valid).toBe(true);
    expect(result.body.trim()).toBe("");
  });
});
