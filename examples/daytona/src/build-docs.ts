/**
 * Fetch the Daytona product docs listed in https://www.daytona.io/docs/llms.txt
 * and write cached markdown plus ACOs under docs-demo/.
 *
 * The index lists about 190 markdown URLs. This script keeps the product
 * guides (snapshots, volumes, fork, network limits, SDK auth, computer use,
 * and the other top-level docs). It skips OpenAPI files, the concatenated
 * llms-full.txt, the 404 page, per-class SDK reference trees, and the
 * third-party integration guides. Re-run only to refresh the fixture.
 * That mints new ACO ids.
 */

import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createACO, FilesystemAdapter, validateACO } from "@atomic-content-protocol/core";
import { EXAMPLE_ROOT, loadPolicy } from "./policy.js";

const DEMO = path.join(EXAMPLE_ROOT, "docs-demo");
const CORPUS = path.join(DEMO, "corpus");
const PAGES = path.join(CORPUS, "pages");
const VAULT = path.join(CORPUS, "vault");

const USER_AGENT = "ACP-Daytona-Benchmark/0.3 (https://github.com/atomic-content-protocol/sdk; docs cache)";
const MAX_CHARS = 100_000;
const AUTHOR = { id: "daytona-benchmark", name: "ACP Daytona Benchmark" };
const TOOL = "@atomic-content-protocol/example-daytona@0.0.0";
const ORIGIN = "https://www.daytona.io/docs/";

const PATHS = [
  "en.md",
  "en/authentication.md",
  "en/sandboxes.md",
  "en/linux-sandboxes.md",
  "en/windows-sandboxes.md",
  "en/macos-sandboxes.md",
  "en/gpu-sandboxes.md",
  "en/isolation.md",
  "en/persistence.md",
  "en/scale.md",
  "en/snapshots.md",
  "en/warm-pools.md",
  "en/declarative-builder.md",
  "en/volumes.md",
  "en/mount-external-storage.md",
  "en/regions.md",
  "en/file-system-operations.md",
  "en/git-operations.md",
  "en/language-server-protocol.md",
  "en/process-code-execution.md",
  "en/pty.md",
  "en/log-streaming.md",
  "en/mcp.md",
  "en/computer-use.md",
  "en/agent-skills.md",
  "en/web-terminal.md",
  "en/ssh-access.md",
  "en/vnc-access.md",
  "en/vpn-connections.md",
  "en/preview.md",
  "en/custom-preview-proxy.md",
  "en/playground.md",
  "en/webhooks.md",
  "en/network-limits.md",
  "en/secrets.md",
  "en/audit-logs.md",
  "en/observability/otel-collection.md",
  "en/bring-your-own-compute.md",
  "en/architecture.md",
  "en/organizations.md",
  "en/api-keys.md",
  "en/sso.md",
  "en/limits.md",
  "en/billing.md",
  "en/acceptable-use.md",
  "en/linked-accounts.md",
  "en/troubleshooting.md",
  "en/typescript-sdk.md",
  "en/python-sdk.md",
  "en/go-sdk.md",
  "en/java-sdk.md",
  "en/ruby-sdk.md",
  "en/tools/cli.md",
  "en/tools/api.md",
];

function slugFor(docPath: string): string {
  if (docPath === "en.md") return "overview";
  const base = docPath.replace(/^en\//, "").replace(/\.md$/, "");
  return base.replace(/\//g, "-");
}

function tagify(value: string): string | null {
  const tag = value
    .toLowerCase()
    .replace(/[`*_#]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (tag.length < 2) return null;
  if (["the", "and", "for", "with", "from", "this", "that", "using"].includes(tag)) return null;
  return tag;
}

function leadSummary(markdown: string): string {
  const prose: string[] = [];
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence || line.startsWith("#") || line.trim().length === 0) continue;
    prose.push(line.trim());
    if (prose.join(" ").length > 700) break;
  }
  const text = prose.join(" ").replace(/\s+/g, " ");
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(" ");
  return (sentences || text).slice(0, 500);
}

function headingTags(docPath: string, markdown: string): string[] {
  const tags: string[] = [];
  const add = (value: string) => {
    const tag = tagify(value);
    if (tag && !tags.includes(tag)) tags.push(tag);
  };
  for (const part of docPath.replace(/^en\//, "").replace(/\.md$/, "").split(/[/-]/)) add(part);
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const heading = /^##\s+(.+)/.exec(line);
    if (heading?.[1]) add(heading[1]);
    if (tags.length >= 7) break;
  }
  return tags.slice(0, 7);
}

function entities(title: string, markdown: string): Array<{ type: string; name: string; confidence: number }> {
  const found: Array<{ type: string; name: string; confidence: number }> = [
    { type: "concept", name: title.slice(0, 200), confidence: 0.95 },
  ];
  const seen = new Set<string>([title.toLowerCase()]);
  const sample = markdown.slice(0, 2000);
  for (const match of sample.matchAll(/`([A-Za-z][A-Za-z0-9_.:-]{2,60})`/g)) {
    const name = match[1];
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    found.push({ type: "technology", name: name.slice(0, 200), confidence: 0.4 });
    if (found.length >= 6) break;
  }
  return found;
}

function titleOf(markdown: string, slug: string): string {
  const heading = /^#\s+(.+)/m.exec(markdown);
  if (heading?.[1]) return heading[1].replace(/[#*`]/g, "").trim().slice(0, 200);
  return slug;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDoc(docPath: string): Promise<{ text: string; lastModified: string | null; truncated: boolean }> {
  const response = await fetch(`${ORIGIN}${docPath}`, {
    headers: { "user-agent": USER_AGENT, accept: "text/markdown, text/plain" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${docPath} returned ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("markdown") && !contentType.includes("text/plain")) {
    throw new Error(`${docPath} content-type ${contentType}`);
  }
  const raw = (await response.text()).split("\0").join("").replace(/\r\n/g, "\n").trim();
  if (raw.startsWith("<!DOCTYPE") || raw.startsWith("<html")) {
    throw new Error(`${docPath} returned HTML, not the markdown doc`);
  }
  return {
    text: raw.slice(0, MAX_CHARS),
    lastModified: response.headers.get("last-modified"),
    truncated: raw.length > MAX_CHARS,
  };
}

export async function buildDocs(): Promise<void> {
  await mkdir(PAGES, { recursive: true });
  await mkdir(path.join(VAULT, ".acp"), { recursive: true });
  for (const name of await readdir(VAULT).catch(() => [] as string[])) {
    if (name.endsWith(".md")) await unlink(path.join(VAULT, name));
  }
  await unlink(path.join(VAULT, ".acp", "index.json")).catch(() => undefined);
  for (const name of await readdir(PAGES).catch(() => [] as string[])) {
    if (name.endsWith(".txt")) await unlink(path.join(PAGES, name));
  }

  const parent = loadPolicy();
  const policy = {
    ...parent,
    catalog_limit: PATHS.length,
  };
  await writeFile(path.join(DEMO, "policy.json"), `${JSON.stringify(policy, null, 2)}\n`, "utf8");

  const storage = new FilesystemAdapter(VAULT);
  const stamped = new Date().toISOString();
  const manifest: Array<Record<string, unknown>> = [];
  const leads: Array<Record<string, string>> = [];
  const sources: Array<Record<string, string>> = [];

  for (const docPath of PATHS) {
    const slug = slugFor(docPath);
    const url = `${ORIGIN}${docPath}`;
    process.stderr.write(`fetch ${slug}\n`);
    const fetched = await fetchDoc(docPath);
    const text = fetched.text;
    if (text.length < 200) throw new Error(`${slug} is only ${text.length} characters`);
    const title = titleOf(text, slug);
    const summary = leadSummary(text);
    const tags = headingTags(docPath, text);
    if (tags.length === 0) tags.push(slug);
    const provenance = {
      summary: { model: "extractive-lead@1", pipeline: "extractive-lead", tool: TOOL, timestamp: stamped },
      tags: { model: "heading-tags@1", pipeline: "heading-tags", tool: TOOL, timestamp: stamped },
      key_entities: { model: "identifier-scan@1", pipeline: "identifier-scan", tool: TOOL, timestamp: stamped },
      classification: { model: "fixed-rule@1", pipeline: "fixed-rule", tool: TOOL, timestamp: stamped },
      language: { model: "fixed-rule@1", pipeline: "fixed-rule", tool: TOOL, timestamp: stamped },
    };
    const aco = await createACO({
      title,
      body: text,
      source_type: "link",
      author: AUTHOR,
      frontmatter: {
        corpus_slug: slug,
        source_url: url,
        summary,
        tags,
        key_entities: entities(title, text),
        classification: "reference",
        language: "en",
        status: "final",
        visibility: "public",
        agent_accessible: true,
        rights: "Copyright Daytona. Not covered by the Apache-2.0 license of this repository.",
        provenance,
      },
    });
    const validation = validateACO(aco.frontmatter);
    if (!validation.valid) throw new Error(`${slug} invalid: ${JSON.stringify(validation.errors)}`);
    await storage.putACO(aco);
    await writeFile(path.join(PAGES, `${slug}.txt`), `${text}\n`, "utf8");
    sources.push({ slug, path: docPath, url });
    manifest.push({
      slug,
      title,
      source_url: url,
      id: String(aco.frontmatter["id"]),
      chars: text.length,
      truncated: fetched.truncated,
      last_modified: fetched.lastModified,
      fetched_at: stamped,
      body_source: "daytona-docs-markdown",
      index: "https://www.daytona.io/docs/llms.txt",
    });
    leads.push({ slug, title, summary, lead: text.slice(0, 900) });
    await sleep(120);
  }

  await writeFile(
    path.join(VAULT, ".acp", "config.json"),
    `${JSON.stringify({ vault_path: ".", author: AUTHOR, enrichment: { quality: "fast" } }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(CORPUS, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`, "utf8");
  await writeFile(path.join(CORPUS, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(CORPUS, "leads.json"), `${JSON.stringify(leads, null, 2)}\n`, "utf8");
  process.stderr.write(`wrote ${manifest.length} docs\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  buildDocs().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
