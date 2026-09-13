import { describe, expect, it } from "vitest";
import { ACOFrontmatterSchema } from "./aco.schema.js";
import { CollectionFrontmatterSchema } from "./collection.schema.js";
import { AuthorSchema, TokenCountsSchema } from "./common.schema.js";
import { ContainerFrontmatterSchema } from "./container.schema.js";

describe("shared schema fragments", () => {
  it("AuthorSchema requires id and name, allows extras", () => {
    expect(AuthorSchema.safeParse({ id: "a", name: "A", url: "x" }).success).toBe(true);
    expect(AuthorSchema.safeParse({ id: "", name: "A" }).success).toBe(false);
    expect(AuthorSchema.safeParse({ id: "a" }).success).toBe(false);
  });

  it("TokenCountsSchema accepts partial non-negative integer counts", () => {
    expect(TokenCountsSchema.safeParse({ approximate: 10 }).success).toBe(true);
    expect(TokenCountsSchema.safeParse({ cl100k: -1 }).success).toBe(false);
    expect(TokenCountsSchema.safeParse({ claude: 1.5 }).success).toBe(false);
  });

  it("ACO, Container and Collection all reject the same bad author", () => {
    const base = {
      id: "x",
      acp_version: "0.2",
      source_type: "manual",
      created: "2026-01-01T00:00:00Z",
      author: { id: "", name: "" },
      title: "t",
    };
    expect(ACOFrontmatterSchema.safeParse({ ...base, object_type: "aco" }).success).toBe(false);
    expect(ContainerFrontmatterSchema.safeParse({ ...base, object_type: "container" }).success).toBe(false);
    expect(CollectionFrontmatterSchema.safeParse({ ...base, object_type: "collection" }).success).toBe(false);
  });
});
