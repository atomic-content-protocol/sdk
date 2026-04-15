import { describe, it, expect } from "vitest";
import { ContainerFrontmatterSchema } from "./container.schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_CONTAINER = {
  id: "0193f5e6-c5f0-7000-8000-000000000010",
  acp_version: "0.2",
  object_type: "container" as const,
  created: "2026-04-13T00:00:00Z",
  author: { id: "user-1", name: "Test Author" },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContainerFrontmatterSchema", () => {
  // ---- Valid cases ----------------------------------------------------------

  it("accepts a valid minimal container (required fields only)", () => {
    const result = ContainerFrontmatterSchema.safeParse(MINIMAL_CONTAINER);
    expect(result.success).toBe(true);
  });

  it("accepts a container with an objects array of string IDs", () => {
    const result = ContainerFrontmatterSchema.safeParse({
      ...MINIMAL_CONTAINER,
      objects: [
        "0193f5e6-c5f0-7000-8000-000000000001",
        "0193f5e6-c5f0-7000-8000-000000000002",
        "0193f5e6-c5f0-7000-8000-000000000003",
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objects).toHaveLength(3);
    }
  });

  it("accepts a container with an empty objects array", () => {
    const result = ContainerFrontmatterSchema.safeParse({
      ...MINIMAL_CONTAINER,
      objects: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full container with all optional fields", () => {
    const result = ContainerFrontmatterSchema.safeParse({
      ...MINIMAL_CONTAINER,
      modified: "2026-04-13T12:00:00Z",
      title: "Research Collection",
      summary: "A curated set of ACP research ACOs.",
      tags: ["research", "acp"],
      objects: ["id-1", "id-2"],
      token_counts: { approximate: 2500, cl100k: 2400 },
      provenance: {
        summary: {
          model: "claude-haiku-4-5",
          timestamp: "2026-04-13T00:00:00Z",
        },
      },
      relationships: [{ rel_type: "related", target_id: "other-container-id" }],
      visibility: "public",
      agent_accessible: false,
      rights: "CC0-1.0",
      expiration: null,
      status: "final",
    });
    expect(result.success).toBe(true);
  });

  // ---- object_type discriminator -------------------------------------------

  it("requires object_type to be 'container'", () => {
    const result = ContainerFrontmatterSchema.safeParse({
      ...MINIMAL_CONTAINER,
      object_type: "aco",
    });
    expect(result.success).toBe(false);
  });

  it("rejects object_type of arbitrary string", () => {
    const result = ContainerFrontmatterSchema.safeParse({
      ...MINIMAL_CONTAINER,
      object_type: "collection",
    });
    expect(result.success).toBe(false);
  });

  // ---- Missing required fields ---------------------------------------------

  it("fails when id is missing", () => {
    const { id: _, ...rest } = MINIMAL_CONTAINER;
    const result = ContainerFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when acp_version is missing", () => {
    const { acp_version: _, ...rest } = MINIMAL_CONTAINER;
    const result = ContainerFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when created is missing", () => {
    const { created: _, ...rest } = MINIMAL_CONTAINER;
    const result = ContainerFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when author is missing", () => {
    const { author: _, ...rest } = MINIMAL_CONTAINER;
    const result = ContainerFrontmatterSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  // ---- Note: containers do NOT require source_type -------------------------

  it("succeeds without source_type (containers have no source_type field)", () => {
    // This confirms the container schema differs from ACO — no source_type required
    const result = ContainerFrontmatterSchema.safeParse(MINIMAL_CONTAINER);
    expect(result.success).toBe(true);
  });

  // ---- objects is an array of string IDs -----------------------------------

  it("rejects objects array containing non-string entries", () => {
    const result = ContainerFrontmatterSchema.safeParse({
      ...MINIMAL_CONTAINER,
      objects: [123, 456],
    });
    expect(result.success).toBe(false);
  });

  it("rejects objects array containing empty strings", () => {
    const result = ContainerFrontmatterSchema.safeParse({
      ...MINIMAL_CONTAINER,
      objects: [""],
    });
    expect(result.success).toBe(false);
  });

  // ---- Forward compatibility (.passthrough) --------------------------------

  it("preserves unknown fields after validation", () => {
    const input = {
      ...MINIMAL_CONTAINER,
      future_field: "forward-compat-value",
    };
    const result = ContainerFrontmatterSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["future_field"]).toBe(
        "forward-compat-value"
      );
    }
  });

  // ---- Tags max ------------------------------------------------------------

  it("accepts up to 20 tags", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    const result = ContainerFrontmatterSchema.safeParse({ ...MINIMAL_CONTAINER, tags });
    expect(result.success).toBe(true);
  });

  it("rejects more than 20 tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
    const result = ContainerFrontmatterSchema.safeParse({ ...MINIMAL_CONTAINER, tags });
    expect(result.success).toBe(false);
  });
});
