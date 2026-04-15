import { describe, it, expect } from "vitest";
import { ACOFrontmatterSchema } from "./aco.schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_ACO = {
  id: "0193f5e6-c5f0-7000-8000-000000000001",
  acp_version: "0.2",
  object_type: "aco" as const,
  source_type: "manual" as const,
  created: "2026-04-13T00:00:00Z",
  author: { id: "user-1", name: "Test Author" },
};

const FULL_ACO = {
  ...MINIMAL_ACO,
  modified: "2026-04-13T12:00:00Z",
  title: "A full ACO",
  language: "en",
  content_hash: "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  token_counts: { approximate: 100, cl100k: 95 },
  tags: ["ai", "protocol", "test"],
  classification: "reference",
  key_entities: [
    { type: "concept", name: "ACP", confidence: 0.95 },
    { type: "organization", name: "Stacklist" },
  ],
  source_url: "https://example.com/article",
  source_file: "document.pdf",
  source_context: {
    model: "claude-sonnet-4-6",
    thread_id: "thread-abc",
    platform: "claude.ai",
  },
  media: null,
  summary: "A comprehensive test ACO covering all optional fields.",
  confidence: 0.8,
  provenance: {
    summary: {
      model: "claude-haiku-4-5",
      timestamp: "2026-04-13T00:00:00Z",
      confidence: 0.9,
    },
  },
  relationships: [
    { rel_type: "references", target_id: "0193f5e6-c5f0-7000-8000-000000000002" },
  ],
  visibility: "public" as const,
  agent_accessible: true,
  rights: "CC-BY-4.0",
  expiration: null,
  status: "final" as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACOFrontmatterSchema", () => {
  // ---- Valid cases ----------------------------------------------------------

  it("accepts a valid minimal ACO (6 required fields)", () => {
    const result = ACOFrontmatterSchema.safeParse(MINIMAL_ACO);
    expect(result.success).toBe(true);
  });

  it("accepts a valid full ACO with all optional fields populated", () => {
    const result = ACOFrontmatterSchema.safeParse(FULL_ACO);
    expect(result.success).toBe(true);
  });

  // ---- Missing required fields (one at a time) -----------------------------

  it("fails when id is missing", () => {
    const { id: _, ...rest } = MINIMAL_ACO;
    const result = ACOFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when acp_version is missing", () => {
    const { acp_version: _, ...rest } = MINIMAL_ACO;
    const result = ACOFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when object_type is missing", () => {
    const { object_type: _, ...rest } = MINIMAL_ACO;
    const result = ACOFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when source_type is missing", () => {
    const { source_type: _, ...rest } = MINIMAL_ACO;
    const result = ACOFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when created is missing", () => {
    const { created: _, ...rest } = MINIMAL_ACO;
    const result = ACOFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when author is missing", () => {
    const { author: _, ...rest } = MINIMAL_ACO;
    const result = ACOFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  // ---- Enum validation -----------------------------------------------------

  it("fails when source_type is an invalid enum value", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      source_type: "screenshot",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid source_type values", () => {
    const validTypes = [
      "link",
      "uploaded_md",
      "manual",
      "converted_pdf",
      "converted_doc",
      "converted_video",
      "selected_text",
      "llm_capture",
    ];
    for (const source_type of validTypes) {
      const result = ACOFrontmatterSchema.safeParse({ ...MINIMAL_ACO, source_type });
      expect(result.success, `source_type "${source_type}" should be valid`).toBe(true);
    }
  });

  it("fails when object_type is not 'aco'", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      object_type: "container",
    });
    expect(result.success).toBe(false);
  });

  it("fails when object_type is an arbitrary string", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      object_type: "document",
    });
    expect(result.success).toBe(false);
  });

  // ---- content_hash format -------------------------------------------------

  it("accepts a valid sha256: prefixed content_hash", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      content_hash: "sha256:a1b2c3d4e5f6",
    });
    expect(result.success).toBe(true);
  });

  it("accepts sha256: prefix with uppercase hex digits", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      content_hash: "sha256:A1B2C3D4E5F6",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a content_hash with md5: prefix", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      content_hash: "md5:abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a plain hex string without sha256: prefix", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      content_hash: "a1b2c3d4e5f6",
    });
    expect(result.success).toBe(false);
  });

  // ---- Forward compatibility (.passthrough) --------------------------------

  it("preserves unknown fields after validation (.passthrough)", () => {
    const input = {
      ...MINIMAL_ACO,
      future_field: "some value",
      another_unknown: 42,
    };
    const result = ACOFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["future_field"]).toBe("some value");
      expect((result.data as Record<string, unknown>)["another_unknown"]).toBe(42);
    }
  });

  it("preserves unknown author subfields (.passthrough on author)", () => {
    const input = {
      ...MINIMAL_ACO,
      author: { id: "user-1", name: "Test Author", email: "test@example.com" },
    };
    const result = ACOFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.author as Record<string, unknown>)["email"]).toBe("test@example.com");
    }
  });

  // ---- Tags ----------------------------------------------------------------

  it("accepts an array of 20 tags (max)", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    const result = ACOFrontmatterSchema.safeParse({ ...MINIMAL_ACO, tags });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toHaveLength(20);
    }
  });

  it("rejects an array of 21 tags (over max)", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    const result = ACOFrontmatterSchema.safeParse({ ...MINIMAL_ACO, tags });
    expect(result.success).toBe(false);
  });

  it("preserves tag values after validation", () => {
    const tags = ["ai", "protocol", "test"];
    const result = ACOFrontmatterSchema.safeParse({ ...MINIMAL_ACO, tags });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(tags);
    }
  });

  // ---- key_entities --------------------------------------------------------

  it("validates the key_entities nested structure (type + name required)", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      key_entities: [{ type: "person", name: "Ada Lovelace", confidence: 0.99 }],
    });
    expect(result.success).toBe(true);
  });

  it("validates key_entity without confidence (human-asserted)", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      key_entities: [{ type: "concept", name: "Protocol" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a key_entity missing the required name field", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      key_entities: [{ type: "person" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a key_entity missing the required type field", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      key_entities: [{ name: "Ada Lovelace" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a key_entity confidence value outside 0-1 range", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      key_entities: [{ type: "person", name: "Ada Lovelace", confidence: 1.5 }],
    });
    expect(result.success).toBe(false);
  });

  // ---- Relationships -------------------------------------------------------

  it("validates a valid relationship edge (rel_type + target_id)", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      relationships: [{ rel_type: "references", target_id: "some-uuid" }],
    });
    expect(result.success).toBe(true);
  });

  it("validates all core rel_type values", () => {
    const coreTypes = [
      "references",
      "derived-from",
      "supersedes",
      "supports",
      "contradicts",
      "part-of",
      "related",
    ];
    for (const rel_type of coreTypes) {
      const result = ACOFrontmatterSchema.safeParse({
        ...MINIMAL_ACO,
        relationships: [{ rel_type, target_id: "target-id" }],
      });
      expect(result.success, `rel_type "${rel_type}" should be valid`).toBe(true);
    }
  });

  it("accepts extension rel_types starting with 'x-'", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      relationships: [{ rel_type: "x-cites", target_id: "target-id" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects relationship edges with invalid rel_type", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      relationships: [{ rel_type: "unknown-type", target_id: "target-id" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects relationship edges missing target_id", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      relationships: [{ rel_type: "references" }],
    });
    expect(result.success).toBe(false);
  });

  it("validates relationship confidence within 0-1 range", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      relationships: [
        { rel_type: "references", target_id: "target-id", confidence: 0.75 },
      ],
    });
    expect(result.success).toBe(true);
  });

  // ---- Access fields -------------------------------------------------------

  it("accepts valid visibility values", () => {
    for (const visibility of ["public", "private", "restricted"]) {
      const result = ACOFrontmatterSchema.safeParse({ ...MINIMAL_ACO, visibility });
      expect(result.success, `visibility "${visibility}" should be valid`).toBe(true);
    }
  });

  it("rejects invalid visibility value", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      visibility: "internal",
    });
    expect(result.success).toBe(false);
  });

  it("accepts agent_accessible as boolean true", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      agent_accessible: true,
    });
    expect(result.success).toBe(true);
  });

  // ---- Confidence ----------------------------------------------------------

  it("rejects confidence outside 0-1 range", () => {
    const result = ACOFrontmatterSchema.safeParse({
      ...MINIMAL_ACO,
      confidence: 1.1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts confidence at boundary values 0.0 and 1.0", () => {
    for (const confidence of [0.0, 1.0]) {
      const result = ACOFrontmatterSchema.safeParse({ ...MINIMAL_ACO, confidence });
      expect(result.success, `confidence ${confidence} should be valid`).toBe(true);
    }
  });
});
