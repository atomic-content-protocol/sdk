import { describe, it, expect } from "vitest";
import { migrate, MigrationError } from "./migrate.js";

describe("migrate", () => {
  // ---- No-op migration (0.2 → 0.2) ----------------------------------------

  it("returns a new object with the same fields for 0.2 → 0.2 (identity migration)", () => {
    const frontmatter = {
      id: "0193f5e6-c5f0-7000-8000-000000000001",
      acp_version: "0.2",
      object_type: "aco",
      source_type: "manual",
      created: "2026-04-13T00:00:00Z",
      author: { id: "user-1", name: "Author" },
    };
    const result = migrate(frontmatter, "0.2", "0.2");
    expect(result).toEqual(frontmatter);
  });

  it("does NOT mutate the input frontmatter (returns a shallow copy)", () => {
    const frontmatter = {
      id: "test-id",
      acp_version: "0.2",
      title: "Original Title",
    };
    const result = migrate(frontmatter, "0.2", "0.2");
    expect(result).not.toBe(frontmatter); // different reference
    expect(result).toEqual(frontmatter);  // same content
  });

  it("preserves all fields through the no-op 0.2 → 0.2 migration", () => {
    const frontmatter = {
      id: "test-id",
      acp_version: "0.2",
      object_type: "aco",
      source_type: "link",
      created: "2026-04-13T00:00:00Z",
      author: { id: "u1", name: "Author" },
      title: "Test Title",
      tags: ["ai", "test"],
      agent_accessible: true,
    };
    const result = migrate(frontmatter, "0.2", "0.2");
    expect(result["title"]).toBe("Test Title");
    expect(result["tags"]).toEqual(["ai", "test"]);
    expect(result["agent_accessible"]).toBe(true);
  });

  // ---- Unsupported version paths -------------------------------------------

  it("throws MigrationError for '0.1' → '0.2' (no migration registered)", () => {
    expect(() => migrate({}, "0.1", "0.2")).toThrow(MigrationError);
  });

  it("throws MigrationError with informative message for missing migration path", () => {
    expect(() => migrate({}, "0.1", "0.2")).toThrow(/0\.1/);
    expect(() => migrate({}, "0.1", "0.2")).toThrow(/0\.2/);
  });

  it("throws MigrationError for unknown source version '9.9' → '0.2'", () => {
    expect(() => migrate({}, "9.9", "0.2")).toThrow(MigrationError);
  });

  it("throws MigrationError for unknown target version '0.2' → '9.9'", () => {
    expect(() => migrate({}, "0.2", "9.9")).toThrow(MigrationError);
  });

  it("throws MigrationError for completely unknown version pair", () => {
    expect(() => migrate({}, "1.0", "2.0")).toThrow(MigrationError);
  });

  // ---- Error class contract ------------------------------------------------

  it("MigrationError has code property 'MIGRATION_ERROR'", () => {
    let caught: MigrationError | null = null;
    try {
      migrate({}, "0.1", "0.2");
    } catch (e) {
      if (e instanceof MigrationError) caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("MIGRATION_ERROR");
  });

  it("MigrationError is an instance of Error", () => {
    expect(() => migrate({}, "0.1", "0.2")).toThrow(Error);
  });
});
