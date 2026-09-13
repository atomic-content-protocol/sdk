import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, findVaultRoot } from "./config.js";
import { parsePipelines, planBatch, resolveProviderConfig } from "./enrichment.js";
import { CliError } from "./errors.js";
import { resolveAuthor } from "./author.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "acp-cli-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function writeConfig(root: string, cfg: unknown) {
  await fs.mkdir(path.join(root, ".acp"), { recursive: true });
  await fs.writeFile(path.join(root, ".acp", "config.json"), JSON.stringify(cfg));
}

describe("config discovery", () => {
  it("walks up to the nearest .acp/config.json and resolves vault_path relative to it", async () => {
    const root = await tmp();
    await writeConfig(root, { vault_path: "content" });
    const nested = path.join(root, "a", "b");
    await fs.mkdir(nested, { recursive: true });

    expect(await findVaultRoot(nested)).toBe(root);
    const { config, root: found } = await loadConfig(nested);
    expect(found).toBe(root);
    expect(config.vault_path).toBe(path.join(root, "content"));
  });

  it("falls back to the given directory when no config exists", async () => {
    const dir = await tmp();
    const { config, root } = await loadConfig(dir);
    expect(root).toBeNull();
    expect(config.vault_path).toBe(dir);
  });

  it("accepts a file path and uses its vault", async () => {
    const root = await tmp();
    await writeConfig(root, { vault_path: "." });
    const file = path.join(root, "x.md");
    await fs.writeFile(file, "---\nid: x\n---\n");
    expect((await loadConfig(file)).config.vault_path).toBe(root);
  });

  it("rejects malformed and unknown-key configs loudly", async () => {
    const root = await tmp();
    await writeConfig(root, { vault_path: ".", enrichment: { anthropic: { apiKey: "wrong-case" } } });
    await expect(loadConfig(root)).rejects.toBeInstanceOf(CliError);
    await fs.writeFile(path.join(root, ".acp", "config.json"), "{ nope");
    await expect(loadConfig(root)).rejects.toThrow(/Could not parse/);
  });

  it("keeps absolute vault_path values as-is (legacy configs)", async () => {
    const root = await tmp();
    const abs = path.join(root, "elsewhere");
    await writeConfig(root, { vault_path: abs });
    expect((await loadConfig(root)).config.vault_path).toBe(abs);
  });
});

describe("enrichment helpers", () => {
  it("parsePipelines validates and de-duplicates", () => {
    expect(parsePipelines("unified, embed,unified")).toEqual(["unified", "embed"]);
    expect(() => parsePipelines("unified,bogus")).toThrow(/Unknown pipeline/);
    expect(() => parsePipelines(" , ")).toThrow(/No pipelines/);
  });

  it("planBatch selects only what fits the budget, in order, before any spend", () => {
    const acos = ["a", "b", "c", "d"].map((id) => ({ frontmatter: { id }, body: "word ".repeat(2_000) }));
    const unlimited = planBatch(acos, "claude-haiku-4-5");
    expect(unlimited.selected).toHaveLength(4);
    expect(unlimited.deferred).toHaveLength(0);

    const perACO = unlimited.perACOCost[0]!;
    const capped = planBatch(acos, "claude-haiku-4-5", perACO * 2.5);
    expect(capped.selected.map((a) => a.frontmatter["id"])).toEqual(["a", "b"]);
    expect(capped.deferred.map((a) => a.frontmatter["id"])).toEqual(["c", "d"]);
    expect(capped.totalCost).toBeLessThanOrEqual(perACO * 2.5);

    expect(planBatch(acos, "claude-haiku-4-5", 0).selected).toHaveLength(0);
  });

  it("resolveProviderConfig merges config file and environment", () => {
    expect(resolveProviderConfig({ vault_path: "." }, {})).toBeNull();
    const fromEnv = resolveProviderConfig({ vault_path: "." }, { ANTHROPIC_API_KEY: "k", ACP_QUALITY: "best" });
    expect(fromEnv).toMatchObject({ quality: "best", anthropic: { apiKey: "k" } });
    const fromFile = resolveProviderConfig(
      { vault_path: ".", enrichment: { quality: "balanced", openai: { model: "gpt-5.6-terra", embedding_model: "text-embedding-3-large" } } },
      { OPENAI_API_KEY: "o" }
    );
    expect(fromFile).toMatchObject({ quality: "balanced", openai: { apiKey: "o", model: "gpt-5.6-terra", embeddingModel: "text-embedding-3-large" } });
  });
});

describe("resolveAuthor", () => {
  it("prefers flags, then config, and never prompts when non-interactive", async () => {
    expect(await resolveAuthor({ authorId: "a", authorName: "A" })).toEqual({ id: "a", name: "A" });
    expect(await resolveAuthor({ config: { author: { id: "c", name: "C" } } })).toEqual({ id: "c", name: "C" });
    // Under vitest stdin is not a TTY: must resolve without hanging (git config or unknown).
    const fallback = await resolveAuthor({ cwd: os.tmpdir() });
    expect(typeof fallback.id).toBe("string");
    expect(fallback.id.length).toBeGreaterThan(0);
  });
});
