import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FilesystemAdapter } from "./filesystem.adapter.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAco(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    frontmatter: {
      id,
      acp_version: "0.2",
      object_type: "aco",
      source_type: "manual",
      created: `2026-04-13T00:00:0${id.slice(-1)}Z`, // unique created per ACO
      author: { id: "user-1", name: "Test Author" },
      ...overrides,
    },
    body: `# ACO ${id}\n\nContent for ${id}.`,
  };
}

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "acp-test-")
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  // Clean up all temp directories created during the test
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FilesystemAdapter", () => {
  // ---- Vault directory creation --------------------------------------------

  it("creates vault directory on first write if it does not exist", async () => {
    const base = await makeTempDir();
    const vaultPath = path.join(base, "new-vault", "nested");
    const adapter = new FilesystemAdapter(vaultPath);

    const aco = makeAco("test-id-1");
    await adapter.putACO(aco);

    const stat = await fs.stat(vaultPath);
    expect(stat.isDirectory()).toBe(true);
  });

  // ---- putACO + getACO round-trip ------------------------------------------

  it("stores and retrieves an ACO with matching frontmatter and body", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const aco = makeAco("0193f5e6-0000-7000-8000-000000000001");
    await adapter.putACO(aco);

    const retrieved = await adapter.getACO("0193f5e6-0000-7000-8000-000000000001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.frontmatter["id"]).toBe("0193f5e6-0000-7000-8000-000000000001");
    expect(retrieved!.frontmatter["acp_version"]).toBe("0.2");
    expect(retrieved!.frontmatter["object_type"]).toBe("aco");
    expect(retrieved!.frontmatter["source_type"]).toBe("manual");
    expect(retrieved!.body.trim()).toBe(aco.body.trim());
  });

  it("overwrites an existing ACO on putACO (upsert semantics)", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id = "0193f5e6-0000-7000-8000-000000000002";
    await adapter.putACO(makeAco(id, { title: "Original Title" }));
    await adapter.putACO(makeAco(id, { title: "Updated Title" }));

    const retrieved = await adapter.getACO(id);
    expect(retrieved!.frontmatter["title"]).toBe("Updated Title");
  });

  it("returns null for getACO with a non-existent ID", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const result = await adapter.getACO("non-existent-id");
    expect(result).toBeNull();
  });

  // ---- listACOs ------------------------------------------------------------

  it("listACOs returns all stored ACOs", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const ids = [
      "0193f5e6-0000-7000-8000-000000000001",
      "0193f5e6-0000-7000-8000-000000000002",
      "0193f5e6-0000-7000-8000-000000000003",
    ];
    for (const id of ids) {
      await adapter.putACO(makeAco(id));
    }

    const all = await adapter.listACOs();
    expect(all).toHaveLength(3);

    const returnedIds = all.map((a) => String(a.frontmatter["id"]));
    expect(returnedIds.sort()).toEqual(ids.sort());
  });

  it("listACOs returns empty array when vault is empty", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);
    const all = await adapter.listACOs();
    expect(all).toEqual([]);
  });

  // ---- deleteACO -----------------------------------------------------------

  it("deleteACO removes the ACO so getACO returns null", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id = "0193f5e6-0000-7000-8000-000000000004";
    await adapter.putACO(makeAco(id));

    // Verify it exists
    const before = await adapter.getACO(id);
    expect(before).not.toBeNull();

    // Delete it
    await adapter.deleteACO(id);

    // Verify it's gone
    const after = await adapter.getACO(id);
    expect(after).toBeNull();
  });

  it("deleteACO is a no-op for non-existent ID (does not throw)", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    await expect(adapter.deleteACO("does-not-exist")).resolves.toBeUndefined();
  });

  it("deleteACO removes the ACO from listACOs results", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id = "0193f5e6-0000-7000-8000-000000000005";
    await adapter.putACO(makeAco(id));
    await adapter.deleteACO(id);

    const all = await adapter.listACOs();
    expect(all).toHaveLength(0);
  });

  // ---- queryACOs by tags ---------------------------------------------------

  it("queryACOs by tags returns only ACOs with matching tags", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id1 = "0193f5e6-0000-7000-8000-000000000010";
    const id2 = "0193f5e6-0000-7000-8000-000000000011";
    const id3 = "0193f5e6-0000-7000-8000-000000000012";

    await adapter.putACO(makeAco(id1, { tags: ["ai", "protocol"] }));
    await adapter.putACO(makeAco(id2, { tags: ["research", "papers"] }));
    await adapter.putACO(makeAco(id3, { tags: ["ai", "tools"] }));

    const results = await adapter.queryACOs({ tags: ["ai"] });
    const resultIds = results.map((a) => String(a.frontmatter["id"]));

    expect(resultIds).toContain(id1);
    expect(resultIds).toContain(id3);
    expect(resultIds).not.toContain(id2);
    expect(results).toHaveLength(2);
  });

  it("queryACOs by tags uses OR matching (any tag can match)", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id1 = "0193f5e6-0000-7000-8000-000000000020";
    const id2 = "0193f5e6-0000-7000-8000-000000000021";

    await adapter.putACO(makeAco(id1, { tags: ["acp"] }));
    await adapter.putACO(makeAco(id2, { tags: ["protocol"] }));

    const results = await adapter.queryACOs({ tags: ["acp", "protocol"] });
    expect(results).toHaveLength(2);
  });

  it("queryACOs returns empty array when no ACOs match the query", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id = "0193f5e6-0000-7000-8000-000000000030";
    await adapter.putACO(makeAco(id, { tags: ["ai"] }));

    const results = await adapter.queryACOs({ tags: ["unrelated-tag"] });
    expect(results).toHaveLength(0);
  });

  // ---- queryACOs by source_type -------------------------------------------

  it("queryACOs by source_type returns matching ACOs only", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id1 = "0193f5e6-0000-7000-8000-000000000040";
    const id2 = "0193f5e6-0000-7000-8000-000000000041";

    await adapter.putACO(makeAco(id1, { source_type: "link" }));
    await adapter.putACO(makeAco(id2, { source_type: "manual" }));

    const results = await adapter.queryACOs({ source_type: ["link"] });
    expect(results).toHaveLength(1);
    expect(results[0].frontmatter["id"]).toBe(id1);
  });

  // ---- Frontmatter and body fidelity ---------------------------------------

  it("stored ACO body is preserved exactly through round-trip", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id = "0193f5e6-0000-7000-8000-000000000050";
    const body = "# My Document\n\nThis is **bold** and _italic_.\n\n- item 1\n- item 2";

    await adapter.putACO({
      frontmatter: {
        id,
        acp_version: "0.2",
        object_type: "aco",
        source_type: "manual",
        created: "2026-04-13T00:00:00Z",
        author: { id: "user-1", name: "Author" },
      },
      body,
    });

    const retrieved = await adapter.getACO(id);
    expect(retrieved!.body.trim()).toBe(body.trim());
  });

  it("stored ACO tags are preserved through round-trip", async () => {
    const vault = await makeTempDir();
    const adapter = new FilesystemAdapter(vault);

    const id = "0193f5e6-0000-7000-8000-000000000060";
    const tags = ["knowledge", "protocol", "acp", "test"];

    await adapter.putACO(makeAco(id, { tags }));

    const retrieved = await adapter.getACO(id);
    expect(retrieved!.frontmatter["tags"]).toEqual(tags);
  });
});
