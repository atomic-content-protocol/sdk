/**
 * @atomic-content-protocol/web/build: every page of a site as an ACO.
 *
 * Runs at build or publish time, in Node. Each page becomes `<path>.md`, made
 * the same way Stacklist makes card ACOs (`createACO` with `status: final`,
 * `agent_accessible: true` and `source_url`, enriched by the UnifiedPipeline),
 * written with the SDK's own serializer so every file is conformant.
 *
 * Kept up to date cheaply: a page whose text didn't change keeps its ACO and
 * enrichment untouched; a changed page keeps its `id` and `created`, gets a new
 * `modified`, and is enriched again. The manifest at `/.well-known/acp.json`
 * records what every page costs an agent to read as HTML and as ACO.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ACO,
  computeContentHash,
  computeTokenCounts,
  createACO,
  extractPageFromHtml,
  isExtractionTooThin,
  parseACO,
  serializeACO,
} from "@atomic-content-protocol/core";
import { acoPathFor } from "../worker/serve.js";

/** Stamped into enrichment provenance and the manifest, per ACP §3.13. */
export const TOOL = "@atomic-content-protocol/web@0.3.0";

export interface SitePage {
  /** URL path on the site, e.g. "/about". */
  path: string;
  html: string;
}

export interface EnrichConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  quality?: "fast" | "balanced" | "best";
}

export interface BuildOptions {
  pages: AsyncIterable<SitePage> | Iterable<SitePage>;
  /** The site's public origin, e.g. "https://example.com". Used for `source_url`. */
  origin: string;
  /** Where to write `<path>.md` and `.well-known/acp.json`: the folder the site's static files are served from. */
  outDir: string;
  /** ACP §3.4: who these objects belong to. Usually the business. */
  author: { id: string; name: string };
  /** Enrich new and changed pages (summary, tags, key entities). Off when no key is given. */
  enrich?: EnrichConfig | false;
  /** Also write `/llms.txt` listing the ACOs, unless the site already has one. Default true. */
  llmsTxt?: boolean;
  log?: (line: string) => void;
}

export interface PageEntry {
  path: string;
  url: string;
  markdown: string;
  id: string;
  title?: string;
  content_hash: string;
  /** Hash of everything the ACO is built from (title, description, text): decides whether to rebuild. */
  source_hash: string;
  /** What reading this page costs an agent, in tokens (cl100k when tiktoken is installed). */
  tokens: { html: number; aco: number };
  status: "new" | "changed" | "unchanged";
}

export interface Manifest {
  version: "1.0";
  site: string;
  generator: string;
  envelope: { media_type: string; page_markdown: string; discovery: string };
  pages: PageEntry[];
  skipped: { path: string; reason: string }[];
  totals: { pages: number; html_tokens: number; aco_tokens: number; saved_percent: number };
  last_updated: string;
}

export const MANIFEST_PATH = ".well-known/acp.json";

export async function buildSiteACOs(options: BuildOptions): Promise<Manifest> {
  const log = options.log ?? (() => {});
  const origin = options.origin.replace(/\/+$/, "");
  const previous = await readManifest(options.outDir);
  const enricher = options.enrich ? await makeEnricher(options.enrich) : null;

  const pages: PageEntry[] = [];
  const skipped: Manifest["skipped"] = [];

  for await (const page of options.pages) {
    const acoPath = acoPathFor(page.path);
    if (!acoPath || acoPath === page.path) continue;
    const url = `${origin}${page.path}`;
    const extracted = extractPageFromHtml(page.html, url);
    if (isExtractionTooThin(extracted.text, extracted.title)) {
      skipped.push({ path: page.path, reason: "too little readable text" });
      continue;
    }

    const contentHash = computeContentHash(extracted.text);
    // A new title or description is a change too, even when the text is the same.
    const sourceHash = computeContentHash(
      [extracted.title ?? "", extracted.description ?? "", extracted.text].join("\n")
    );
    const before = previous.get(page.path);
    const file = insideOutDir(options.outDir, acoPath);
    if (!file) {
      skipped.push({ path: page.path, reason: "path outside the site" });
      continue;
    }
    let status: PageEntry["status"] = "new";
    const existing = before ? await readFile(file, "utf8").then(parseACO, () => null) : null;
    let aco: ACO;

    if (existing && before?.source_hash === sourceHash) {
      aco = { frontmatter: existing.frontmatter, body: existing.body };
      status = "unchanged";
    } else {
      aco = await createACO({
        title: extracted.title,
        body: extracted.text,
        source_type: "link",
        author: options.author,
        frontmatter: { status: "final", visibility: "public", agent_accessible: true, source_url: url },
      });
      if (before) {
        // Same page, new content: one identity over time.
        aco.frontmatter.id = before.id;
        if (before.created) aco.frontmatter.created = before.created;
        aco.frontmatter.modified = new Date().toISOString();
        status = "changed";
      }
      if (enricher) {
        try {
          aco = await enricher.enrichOne(aco, { tool: TOOL });
        } catch (error) {
          log(`enrichment failed for ${page.path}: ${(error as Error).message}`);
        }
      }
    }

    const serialized = `${serializeACO(aco.frontmatter, aco.body)}\n`;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, serialized);

    const [htmlTokens, acoTokens] = await Promise.all([tokens(page.html), tokens(serialized)]);
    pages.push({
      path: page.path,
      url,
      markdown: `${origin}${acoPath}`,
      id: String(aco.frontmatter.id),
      title: typeof aco.frontmatter.title === "string" ? aco.frontmatter.title : undefined,
      content_hash: contentHash,
      source_hash: sourceHash,
      tokens: { html: htmlTokens, aco: acoTokens },
      status,
    });
    log(`${status.padEnd(9)} ${page.path}  ${htmlTokens} → ${acoTokens} tokens`);
  }

  // ACOs this tool wrote last time for pages that are gone (or no longer qualify) are
  // removed, so an agent can't keep reading a page the site took down.
  const kept = new Set(pages.map((p) => p.path));
  for (const gone of [...previous.keys()].filter((p) => !kept.has(p))) {
    const acoPath = acoPathFor(gone);
    const file = acoPath ? insideOutDir(options.outDir, acoPath) : null;
    if (file) await rm(file, { force: true });
    log(`removed   ${gone}`);
  }

  const htmlTotal = pages.reduce((sum, p) => sum + p.tokens.html, 0);
  const acoTotal = pages.reduce((sum, p) => sum + p.tokens.aco, 0);
  const manifest: Manifest = {
    version: "1.0",
    site: origin,
    generator: TOOL,
    envelope: {
      media_type: "text/markdown",
      page_markdown: `${origin}/{path}.md`,
      discovery:
        'Every page answers at <path>.md as an Atomic Content Object. HTML pages carry Link: <path>.md; rel="alternate"; type="text/markdown", and requests that prefer text/markdown get the ACO directly.',
    },
    pages: pages.sort((a, b) => a.path.localeCompare(b.path)),
    skipped,
    totals: {
      pages: pages.length,
      html_tokens: htmlTotal,
      aco_tokens: acoTotal,
      saved_percent: htmlTotal ? Math.round((1 - acoTotal / htmlTotal) * 1000) / 10 : 0,
    },
    last_updated: new Date().toISOString(),
  };

  await mkdir(path.join(options.outDir, ".well-known"), { recursive: true });
  await writeFile(path.join(options.outDir, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.llmsTxt !== false) await writeLlmsTxt(options.outDir, manifest);
  return manifest;
}

/** Tokens the way the SDK counts them everywhere else: cl100k when available, else chars/4. */
async function tokens(text: string): Promise<number> {
  const counts = await computeTokenCounts(text);
  return counts.cl100k ?? counts.approximate;
}

/** `outDir` + the ACO path, or null if the path would land outside `outDir`. */
function insideOutDir(outDir: string, acoPath: string): string | null {
  const root = path.resolve(outDir);
  const file = path.resolve(root, `.${acoPath}`);
  return file.startsWith(root + path.sep) ? file : null;
}

interface Previous {
  id: string;
  source_hash?: string;
  created?: string;
}

async function readManifest(outDir: string): Promise<Map<string, Previous>> {
  try {
    const manifest = JSON.parse(await readFile(path.join(outDir, MANIFEST_PATH), "utf8")) as Manifest;
    const map = new Map<string, Previous>();
    for (const page of manifest.pages) {
      const acoPath = acoPathFor(page.path);
      const file = acoPath ? insideOutDir(outDir, acoPath) : null;
      const existing = file ? await readFile(file, "utf8").then(parseACO, () => null) : null;
      const created = existing?.frontmatter.created;
      map.set(page.path, {
        id: page.id,
        source_hash: page.source_hash,
        created: typeof created === "string" ? created : undefined,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function makeEnricher(config: EnrichConfig) {
  if (!config.anthropicApiKey && !config.openaiApiKey) return null;
  const { BatchEnricher, ProviderRouter, UnifiedPipeline } = await import("@atomic-content-protocol/enrichment");
  const router = ProviderRouter.fromConfig({
    quality: config.quality ?? "fast",
    ...(config.anthropicApiKey ? { anthropic: { apiKey: config.anthropicApiKey } } : {}),
    ...(config.openaiApiKey ? { openai: { apiKey: config.openaiApiKey } } : {}),
  });
  return new BatchEnricher(router, [new UnifiedPipeline()]);
}

/** In every llms.txt this package writes, whatever its version, so it knows which ones are its own. */
const LLMS_MARK = "Generated by @atomic-content-protocol/web";

/** A plain index for agents that look for llms.txt. Never overwrites one the site wrote itself. */
async function writeLlmsTxt(outDir: string, manifest: Manifest) {
  const file = path.join(outDir, "llms.txt");
  const existing = await readFile(file, "utf8").catch(() => null);
  if (existing !== null && !existing.includes(LLMS_MARK)) return;
  const lines = [
    `# ${new URL(manifest.site).host}`,
    "",
    `> Every page of this site is available as an Atomic Content Object (Markdown with structured frontmatter). ${LLMS_MARK} (${TOOL}).`,
    "",
    "## Pages",
    "",
    ...manifest.pages.map((p) => `- [${p.title ?? p.path}](${p.markdown})`),
    "",
  ];
  await writeFile(file, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Page sources
// ---------------------------------------------------------------------------

/** Every `.html` file in a static export (`out/`, `dist/`, `public/`). */
export async function* pagesFromDirectory(dir: string): AsyncGenerator<SitePage> {
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const file = path.join(entry.parentPath, entry.name);
    const relative = `/${path.relative(dir, file).split(path.sep).join("/")}`;
    if (/^\/(404|500)\.html$/.test(relative)) continue;
    const pagePath = relative.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
    yield { path: pagePath || "/", html: await readFile(file, "utf8") };
  }
}

/**
 * Every page in a running site's sitemap (a local preview or the live site).
 * For server-rendered frameworks with no static HTML to read.
 */
export async function* pagesFromSitemap(baseUrl: string, options: { limit?: number } = {}): AsyncGenerator<SitePage> {
  const base = baseUrl.replace(/\/+$/, "");
  const paths = new Set<string>();
  const visit = async (sitemapUrl: string, depth: number) => {
    const response = await fetch(sitemapUrl).catch(() => null);
    if (!response?.ok) return;
    const xml = await response.text();
    for (const loc of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      // Relative locs and XML entities both occur in the wild; a bad entry is skipped, never fatal.
      let location: URL;
      try {
        location = new URL(loc[1].replace(/&amp;/g, "&"), `${base}/`);
      } catch {
        continue;
      }
      // Paths are read from `baseUrl` on purpose: a local preview serves the live site's sitemap.
      if (/sitemap[^/]*\.xml$/i.test(location.pathname) && depth < 2)
        await visit(`${base}${location.pathname}`, depth + 1);
      else paths.add(location.pathname || "/");
    }
  };
  await visit(`${base}/sitemap.xml`, 0);
  if (!paths.size) paths.add("/");

  let count = 0;
  for (const pagePath of paths) {
    if (options.limit && count >= options.limit) break;
    const response = await fetch(`${base}${pagePath}`, { headers: { accept: "text/html" } }).catch(() => null);
    if (!response?.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) continue;
    count++;
    yield { path: pagePath, html: await response.text() };
  }
}
