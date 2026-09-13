import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FilesystemAdapter } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "@atomic-content-protocol/enrichment";
import { afterEach, describe, expect, it } from "vitest";
import { ACPMCPServer } from "./server.js";
import { ToolRegistry } from "./tool-registry.js";
import { needsPipeline } from "./utils/pipelines.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UNIFIED = {
  tags: ["alpha", "beta"],
  summary: "Alpha summary. Beta detail.",
  classification: "notes",
  key_entities: [{ type: "concept", name: "Alpha", confidence: 0.9 }],
  language: "en",
};

/** Deterministic fake provider: structured output + a toy 3-d embedding derived from the text. */
function fakeProvider(
  opts: { embed?: boolean } = { embed: true }
): IEnrichmentProvider & { calls: { structured: number; embed: number } } {
  const calls = { structured: 0, embed: 0 };
  const p: IEnrichmentProvider & { calls: typeof calls } = {
    name: "Fake/fake-model",
    model: "fake-model",
    embeddingModel: "fake-embed",
    calls,
    complete: async () => "",
    structuredComplete: async <T>() => {
      calls.structured++;
      return UNIFIED as unknown as T;
    },
  };
  if (opts.embed) {
    p.embed = async (text: string) => {
      calls.embed++;
      const t = text.toLowerCase();
      return [t.includes("alpha") ? 1 : 0.1, t.includes("beta") ? 1 : 0.1, t.includes("gamma") ? 1 : 0.1];
    };
  }
  return p;
}

const tempDirs: string[] = [];
async function tempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-mcp-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const d of tempDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const AUTHOR = { author_id: "u1", author_name: "User" };

async function makeServer(opts: { enrichment?: boolean; embed?: boolean } = { enrichment: true, embed: true }) {
  const storage = new FilesystemAdapter(await tempVault());
  const provider = fakeProvider({ embed: opts.embed ?? true });
  const server = new ACPMCPServer({
    storage,
    ...(opts.enrichment === false ? {} : { enrichment: { provider } }),
  });
  return { server, storage, provider };
}

async function create(server: ACPMCPServer, title: string, body: string, extra: Record<string, unknown> = {}) {
  const out = await server.callTool("create_aco", { title, body, ...AUTHOR, ...extra });
  expect(out.success).toBe(true);
  return (out.data as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Registry isolation
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  it("is per instance: two servers do not clobber each other", async () => {
    const a = await makeServer();
    const b = await makeServer({ enrichment: false });
    expect(a.server.toolNames).toHaveLength(15);
    expect(b.server.toolNames).toHaveLength(15);
    // a has real enrichment, b has the stub — they must differ
    const bOut = await b.server.callTool("enrich_aco", { id: "x" });
    expect(bOut.success).toBe(false);
    expect(bOut.error).toMatch(/requires enrichment/);
    const r = new ToolRegistry();
    r.register("x", {
      definition: { name: "x", description: "", inputSchema: { parse: (v: unknown) => v } as never },
      handler: async () => ({ success: true }),
    });
    expect(() =>
      r.register("x", {
        definition: { name: "x", description: "", inputSchema: {} as never },
        handler: async () => ({ success: true }),
      })
    ).toThrow(/already/);
  });

  it("listTools emits MCP-shaped definitions without $schema", async () => {
    const { server } = await makeServer();
    const tools = server.listTools();
    expect(tools.map((t) => t.name)).toContain("find_similar");
    for (const t of tools) {
      expect(t.inputSchema).not.toHaveProperty("$schema");
      expect(t.inputSchema).toHaveProperty("type", "object");
    }
  });

  it("callTool throws a JSON-RPC method-not-found for unknown tools", async () => {
    const { server } = await makeServer();
    await expect(server.callTool("nope", {})).rejects.toMatchObject({ code: -32601 });
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("ACO CRUD tools", () => {
  it("create → read → update(relationships, body) → delete(hard) round-trips", async () => {
    const { server, storage } = await makeServer();
    const a = await create(server, "Alpha", "Body A", { tags: ["alpha"] });
    const b = await create(server, "Beta", "Body B");

    const read = await server.callTool("read_aco", { id: a });
    expect(read.success).toBe(true);
    expect((read.data as { frontmatter: Record<string, unknown> }).frontmatter["title"]).toBe("Alpha");

    const upd = await server.callTool("update_aco", {
      id: a,
      body: "New body A",
      relationships: [{ rel_type: "references", target_id: b, confidence: 0.9 }],
      id_should_be_ignored: "x",
    });
    expect(upd.success).toBe(true);
    const fm = upd.data as Record<string, unknown>;
    expect(fm["relationships"]).toEqual([{ rel_type: "references", target_id: b, confidence: 0.9 }]);
    expect(fm["id"]).toBe(a);
    expect(fm["modified"]).toBeDefined();
    const stored = await storage.getACO(a);
    // serializeACO terminates the file with a newline; body identity modulo that is preserved.
    expect(stored?.body.trimEnd()).toBe("New body A");
    expect(stored?.frontmatter["content_hash"]).not.toBe((read.data as any).frontmatter.content_hash);
    expect(await storage.getEdgesFrom(a)).toEqual([{ rel_type: "references", target_id: b, confidence: 0.9 }]);

    const badRel = await server.callTool("update_aco", { id: a, relationships: [{ rel_type: "bogus", target_id: b }] });
    expect(badRel.success).toBe(false);

    const del = await server.callTool("delete_aco", { id: a, hard: true });
    expect(del.success).toBe(true);
    expect(await storage.getACO(a)).toBeNull();
    const again = await server.callTool("delete_aco", { id: a, hard: true });
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/not found/);
  });

  it("soft delete archives and the ACO stays readable", async () => {
    const { server } = await makeServer();
    const a = await create(server, "Alpha", "Body");
    expect((await server.callTool("delete_aco", { id: a })).success).toBe(true);
    const read = await server.callTool("read_aco", { id: a });
    expect((read.data as any).frontmatter.status).toBe("archived");
  });

  it("list_acos sorts and paginates after filtering", async () => {
    const { server } = await makeServer();
    await create(server, "Charlie", "c", { tags: ["x"] });
    await create(server, "Alpha", "a", { tags: ["x"] });
    await create(server, "Bravo", "b", { tags: ["x"] });
    await create(server, "Zulu", "z", { tags: ["other"] });

    const asc = await server.callTool("list_acos", { tags: ["x"], sortBy: "title", order: "asc" });
    expect((asc.data as any).items.map((i: any) => i.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect((asc.data as any).total).toBe(3);

    const page = await server.callTool("list_acos", {
      tags: ["x"],
      sortBy: "title",
      order: "desc",
      limit: 1,
      offset: 1,
    });
    expect((page.data as any).items.map((i: any) => i.title)).toEqual(["Bravo"]);
  });

  it("create_aco rejects unknown source types and unsafe ids never reach storage", async () => {
    const { server } = await makeServer();
    const bad = await server.callTool("create_aco", { title: "x", ...AUTHOR, source_type: "bogus" });
    expect(bad.success).toBe(false);
    const traversal = await server.callTool("read_aco", { id: "../etc/passwd" });
    expect(traversal.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

describe("enrichment tools", () => {
  it("enrich_aco fills empty fields, preserves human values, and is idempotent", async () => {
    const { server, provider } = await makeServer();
    const a = await create(server, "Alpha", "Alpha body", { tags: ["human-tag"] });

    const first = await server.callTool("enrich_aco", { id: a });
    expect(first.success).toBe(true);
    const fm = (first.data as any).frontmatter;
    expect(fm.tags).toEqual(["human-tag"]); // preserved
    expect(fm.summary).toBe(UNIFIED.summary);
    expect(fm.provenance.summary.model).toBe("fake-model");
    expect(fm.provenance.summary.tool).toMatch(/^@atomic-content-protocol\/mcp@/);
    expect(fm.provenance.tags).toBeUndefined();
    expect(provider.calls.structured).toBe(1);

    const second = await server.callTool("enrich_aco", { id: a });
    expect((second.data as any).pipelines_run).toEqual([]);
    expect(provider.calls.structured).toBe(1); // no LLM call

    const forced = await server.callTool("enrich_aco", { id: a, force: true });
    expect((forced.data as any).frontmatter.tags).toEqual(["alpha", "beta"]);
    expect(provider.calls.structured).toBe(2);
  });

  it("needsPipeline mirrors pipeline idempotency", () => {
    const aco = { frontmatter: { tags: ["x"], summary: "", key_entities: [] }, body: "" };
    expect(needsPipeline(aco, "tag")).toBe(false);
    expect(needsPipeline(aco, "summary")).toBe(true);
    expect(needsPipeline(aco, "entity")).toBe(true);
    expect(needsPipeline(aco, "unified")).toBe(true);
    expect(needsPipeline(aco, "embed")).toBe(true);
    expect(needsPipeline({ frontmatter: { provenance: { embedding: {} } }, body: "" }, "embed")).toBe(false);
  });

  it("embed pipeline stores a vector that find_similar and detect_relationships use", async () => {
    const { server, provider } = await makeServer();
    const a = await create(server, "Alpha note", "all about alpha", { tags: ["alpha"] });
    const b = await create(server, "Alpha and beta", "alpha beta", { tags: ["alpha", "beta"] });
    const c = await create(server, "Gamma", "gamma only", { tags: ["gamma"] });

    const batch = await server.callTool("enrich_batch", { ids: [a, b, c], pipelines: ["embed"], concurrency: 3 });
    expect(batch.success).toBe(true);
    expect((batch.data as any).embedded).toBe(3);
    expect(provider.calls.embed).toBe(3);

    const similar = await server.callTool("find_similar", { id: a, limit: 5, threshold: 0 });
    expect((similar.data as any).method).toBe("vector");
    const ids = (similar.data as any).results.map((r: any) => r.id);
    expect(ids[0]).toBe(b); // alpha+beta closer than gamma
    expect(ids).not.toContain(a);

    const byText = await server.callTool("find_similar", { text: "gamma rays", limit: 1 });
    expect((byText.data as any).results[0].id).toBe(c);

    const rel = await server.callTool("detect_relationships", { id: a });
    expect(rel.success).toBe(true);
    expect((rel.data as any).method).toBe("embedding+overlap");
    const top = (rel.data as any).suggestions[0];
    expect(top.target_id).toBe(b);
    expect(top.reason).toMatch(/shared tags: alpha/);
    expect((rel.data as any).suggestions.some((s: any) => s.target_id === c && s.confidence > 0.5)).toBe(false);
  });

  it("find_similar falls back to overlap when no vectors are stored", async () => {
    const { server } = await makeServer();
    const a = await create(server, "Alpha note", "x", { tags: ["alpha", "shared"] });
    const b = await create(server, "Beta note", "y", { tags: ["shared"] });
    await create(server, "Unrelated", "z", { tags: ["zzz"] });
    const out = await server.callTool("find_similar", { id: a });
    expect((out.data as any).method).toBe("content_overlap");
    expect((out.data as any).results.map((r: any) => r.id)).toEqual([b]);
  });

  it("find_similar and detect_relationships work without any enrichment configured", async () => {
    const { server } = await makeServer({ enrichment: false });
    const a = await create(server, "Alpha", "x", { tags: ["t"] });
    await create(server, "Beta", "y", { tags: ["t"] });
    expect((await server.callTool("find_similar", { id: a })).success).toBe(true);
    const rel = await server.callTool("detect_relationships", { id: a });
    expect((rel.data as any).method).toBe("overlap");
    expect((rel.data as any).suggestions).toHaveLength(1);
  });

  it("enrich_batch reports skipped, missing, and failed items", async () => {
    const { server, provider, storage } = await makeServer();
    const a = await create(server, "Alpha", "a");
    const b = await create(server, "Beta", "b", { tags: ["t"] });
    // Fully filled ACO — every unified field already has a value.
    const full = (await storage.getACO(b))!;
    await storage.putACO({
      ...full,
      frontmatter: {
        ...full.frontmatter,
        summary: "s",
        classification: "notes",
        key_entities: [{ type: "concept", name: "x", confidence: 1 }],
        language: "en",
      },
    });
    const out = await server.callTool("enrich_batch", { ids: [a, b, "missing-id"] });
    const data = out.data as any;
    expect(data.enriched).toBe(1);
    expect(data.skipped).toBe(1);
    expect(data.missing).toEqual(["missing-id"]);
    expect(provider.calls.structured).toBe(1);

    const both = await server.callTool("enrich_batch", { ids: [a], container_id: "c" });
    expect(both.success).toBe(false);
  });

  it("validate_vault counts valid documents", async () => {
    const { server } = await makeServer();
    await create(server, "Alpha", "a");
    await create(server, "Beta", "b");
    const out = await server.callTool("validate_vault", {});
    expect(out.data).toMatchObject({ total: 2, valid: 2, invalid: 0 });
  });
});
