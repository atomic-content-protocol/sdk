import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL("../dist/index.js", import.meta.url));

let vault: string;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the built CLI with stdin closed (non-interactive) and no provider keys. */
async function acp(args: string[], cwd = vault): Promise<Run> {
  const env = {
    ...process.env,
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    ACP_QUALITY: "",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
  try {
    const { stdout, stderr } = await exec(process.execPath, [BIN, ...args], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

beforeAll(async () => {
  await fs.access(BIN); // build must have run (turbo test depends on build)
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "acp-cli-e2e-"));
});
afterAll(async () => {
  await fs.rm(vault, { recursive: true, force: true });
});

describe("acp (built binary)", () => {
  it("--version matches package.json", async () => {
    const pkg = JSON.parse(await fs.readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    const r = await acp(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it("init --yes creates a relative config and refuses to clobber without --force", async () => {
    const r = await acp(["init", ".", "--yes", "--author-id", "me@example.com", "--author-name", "Me"]);
    expect(r.code).toBe(0);
    const cfg = JSON.parse(await fs.readFile(path.join(vault, ".acp", "config.json"), "utf8"));
    expect(cfg.vault_path).toBe(".");
    expect(cfg.author).toEqual({ id: "me@example.com", name: "Me" });
    expect(cfg.enrichment.openai.model).not.toBe("gpt-4o-mini");

    const again = await acp(["init", ".", "--yes"]);
    expect(again.code).toBe(2);
    expect(again.stderr).toMatch(/already initialised/);
  });

  it("create → validate → search → stats work from a nested directory via config discovery", async () => {
    const nested = path.join(vault, "notes", "deep");
    await fs.mkdir(nested, { recursive: true });

    const created = await acp(
      [
        "create",
        "--title",
        "Alpha protocol",
        "--body",
        "Knowledge about alpha.",
        "--tags",
        "alpha, protocol",
        "--json",
      ],
      nested
    );
    expect(created.code).toBe(0);
    const fm = JSON.parse(created.stdout);
    expect(fm.tags).toEqual(["alpha", "protocol"]);
    expect(fm.author).toEqual({ id: "me@example.com", name: "Me" });
    // Written to the vault root, not the nested cwd.
    await fs.access(path.join(vault, `${fm.id}.md`));

    const validate = await acp(["validate", "--json"], nested);
    expect(validate.code).toBe(0);
    expect(JSON.parse(validate.stdout)).toMatchObject({ total: 1, valid: 1 });

    const single = await acp(["validate", path.join(vault, `${fm.id}.md`), "--json"]);
    expect(JSON.parse(single.stdout)).toMatchObject({ total: 1, valid: 1 });

    const search = await acp(["search", "alpha"], nested);
    expect(search.code).toBe(0);
    expect(search.stdout).toMatch(/Alpha protocol/);

    const stats = await acp(["stats"], nested);
    expect(stats.code).toBe(0);
    expect(stats.stdout).toMatch(/ACOs:\s+1/);
  });

  it("validate exits 3 and lists errors for an invalid ACO", async () => {
    const bad = path.join(vault, "0193f5e6-0000-7000-8000-00000000bad1.md");
    await fs.writeFile(
      bad,
      "---\nid: 0193f5e6-0000-7000-8000-00000000bad1\nacp_version: '0.2'\nobject_type: aco\n---\nno source_type, author, created\n"
    );
    const r = await acp(["validate", "--json"]);
    expect(r.code).toBe(3);
    const report = JSON.parse(r.stdout);
    expect(report.invalid).toHaveLength(1);
    expect(report.invalid[0].errors.length).toBeGreaterThan(0);
    await fs.rm(bad);
    // The index keeps the id until rebuilt; a delete via adapter is exercised elsewhere.
  });

  it("usage errors are one line with exit 2; no stack traces", async () => {
    const st = await acp(["create", "--title", "x", "--source-type", "bogus"]);
    expect(st.code).toBe(2);
    expect(st.stderr).toMatch(/Invalid --source-type/);
    expect(st.stderr).not.toMatch(/at .*\.js:\d+/);

    const pipes = await acp(["enrich", "some-id", "--pipelines", "nope", "--yes"]);
    expect(pipes.code).toBe(2);
    expect(pipes.stderr).toMatch(/Unknown pipeline/);
  });

  it("enrichment without a provider exits 4 with a hint", async () => {
    const r = await acp(["enrich-batch", "--yes"]);
    expect(r.code).toBe(4);
    expect(r.stderr).toMatch(/No enrichment providers/);
    expect(r.stderr).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("--vault points a command at another vault", async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "acp-cli-other-"));
    try {
      const r = await acp(
        [
          "--vault",
          other,
          "create",
          "--title",
          "Elsewhere",
          "--body",
          "b",
          "--author-id",
          "x",
          "--author-name",
          "X",
          "--json",
        ],
        os.tmpdir()
      );
      expect(r.code).toBe(0);
      const fm = JSON.parse(r.stdout);
      await fs.access(path.join(other, `${fm.id}.md`));
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });
});
