/**
 * Fetch the fixed Wikipedia corpus and write cached pages plus ACOs.
 *
 * Each article is fetched two ways:
 * - `fetchPageForUrl` from `@atomic-content-protocol/core` (what `createACO({ url })` uses).
 *   On current English Wikipedia HTML that extractor returns chrome and embedded
 *   wikitext, not the article prose. The manifest records the length and a prefix
 *   so the gap is visible. Those strings are not the benchmark body.
 * - The MediaWiki `extracts` API (`explaintext`) for the same title. That plaintext
 *   is the cached page and the ACO body, capped at 100_000 characters.
 *
 * Metadata is extractive, not a model call: the summary is the first two sentences,
 * tags come from MediaWiki categories, entities are the article title plus capitalized
 * phrases in the lead. Provenance records that fact. Re-run only when you intend to
 * refresh the committed fixture (`npm run build-corpus`).
 */

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createACO, FilesystemAdapter, fetchPageForUrl, validateACO } from "@atomic-content-protocol/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CORPUS = path.join(ROOT, "corpus");
const PAGES = path.join(CORPUS, "pages");
const VAULT = path.join(CORPUS, "vault");

const USER_AGENT = "ACP-Daytona-Benchmark/0.3 (https://github.com/atomic-content-protocol/sdk; corpus cache)";
const MAX_CHARS = 100_000;
const AUTHOR = { id: "daytona-benchmark", name: "ACP Daytona Benchmark" };
const TOOL = "@atomic-content-protocol/example-daytona@0.0.0";

const TAG_DROP = [
  "articles",
  "wikipedia",
  "wikidata",
  "cs1",
  "webarchive",
  "use dmy",
  "use mdy",
  "coordinates on wikidata",
  "commons category",
  "short description",
  "pages using",
  "all article",
  "good articles",
  "featured articles",
  "citation",
  "incomplete",
  "lacking",
  "needing",
  "vague",
  "permanent dead",
  "accuracy disputes",
  "harv and sfn",
  "articles with",
];

interface SourceEntry {
  slug: string;
  wiki: string;
  kind: string;
}

interface WikiQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        missing?: string;
        extract?: string;
        categories?: Array<{ title: string }>;
        revisions?: Array<{ revid?: number; timestamp?: string }>;
      }
    >;
  };
}

function wikiUrl(wiki: string): string {
  return `https://en.wikipedia.org/wiki/${wiki}`;
}

function leadSummary(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < flat.length && sentences.length < 2; i++) {
    const ch = flat[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const next = flat[i + 1];
    if (next !== undefined && next !== " ") continue;
    const sentence = flat.slice(start, i + 1).trim();
    if (sentence.length > 0) sentences.push(sentence);
    start = i + 1;
  }
  if (sentences.length === 0) sentences.push(flat.slice(0, 500));
  const summary = sentences.join(" ");
  return summary.length > 500 ? summary.slice(0, 500) : summary;
}

function tagify(categoryTitle: string): string | null {
  const raw = categoryTitle
    .replace(/^Category:/i, "")
    .trim()
    .toLowerCase();
  if (raw.length < 2) return null;
  if (TAG_DROP.some((fragment) => raw.includes(fragment))) return null;
  const tag = raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return tag.length > 1 ? tag : null;
}

const STOP_CAPS = new Set([
  "The",
  "A",
  "An",
  "In",
  "On",
  "Of",
  "For",
  "And",
  "This",
  "That",
  "It",
  "Its",
  "Wikipedia",
  "Retrieved",
  "References",
  "External",
  "See",
  "Also",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

function entities(
  title: string,
  lead: string,
  kind: string
): Array<{ type: string; name: string; confidence: number }> {
  const out: Array<{ type: string; name: string; confidence: number }> = [
    { type: kind, name: title, confidence: 0.95 },
  ];
  const seen = new Set([title.toLowerCase()]);
  const re = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g;
  for (const match of lead.matchAll(re)) {
    const name = match[0];
    if (name === undefined || STOP_CAPS.has(name) || name.length < 3) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const words = name.split(/\s+/);
    const type = words.length >= 2 && kind === "person" ? "person" : "concept";
    out.push({ type, name, confidence: 0.4 });
    if (out.length >= 6) break;
  }
  return out;
}

async function wikiPage(wiki: string): Promise<{
  categories: string[];
  extract: string;
  revid?: number;
  revisionTimestamp?: string;
  resolvedTitle?: string;
}> {
  const endpoint = new URL("https://en.wikipedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("prop", "extracts|revisions|categories");
  endpoint.searchParams.set("explaintext", "1");
  endpoint.searchParams.set("exlimit", "1");
  endpoint.searchParams.set("rvprop", "ids|timestamp");
  endpoint.searchParams.set("cllimit", "40");
  endpoint.searchParams.set("clshow", "!hidden");
  endpoint.searchParams.set("redirects", "1");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("titles", wiki.replace(/_/g, " "));
  const response = await fetch(endpoint, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`MediaWiki API ${response.status} for ${wiki}`);
  }
  const data = (await response.json()) as WikiQueryResponse;
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined || !page.extract) {
    throw new Error(`MediaWiki returned no extract for ${wiki}`);
  }
  const categories = (page.categories ?? [])
    .map((category) => tagify(category.title))
    .filter((tag): tag is string => tag !== null);
  const unique: string[] = [];
  for (const tag of categories) {
    if (!unique.includes(tag)) unique.push(tag);
    if (unique.length === 7) break;
  }
  const revision = page.revisions?.[0];
  return {
    categories: unique,
    extract: page.extract.replace(/\r\n/g, "\n").trim().slice(0, MAX_CHARS),
    revid: revision?.revid,
    revisionTimestamp: revision?.timestamp,
    resolvedTitle: page.title,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const sources = JSON.parse(await readFile(path.join(CORPUS, "sources.json"), "utf8")) as SourceEntry[];
  if (sources.length !== 50) {
    throw new Error(`Expected 50 sources, found ${sources.length}`);
  }
  await mkdir(PAGES, { recursive: true });
  await mkdir(path.join(VAULT, ".acp"), { recursive: true });
  for (const name of await readdir(VAULT)) {
    if (name.endsWith(".md")) await unlink(path.join(VAULT, name));
  }
  await unlink(path.join(VAULT, ".acp", "index.json")).catch(() => undefined);
  for (const name of await readdir(PAGES).catch(() => [] as string[])) {
    if (name.endsWith(".txt")) await unlink(path.join(PAGES, name));
  }

  const storage = new FilesystemAdapter(VAULT);
  const stamped = new Date().toISOString();
  const manifest: Array<Record<string, unknown>> = [];
  const leads: Array<Record<string, string>> = [];

  for (const source of sources) {
    const url = wikiUrl(source.wiki);
    process.stderr.write(`fetch ${source.slug}\n`);
    const page = await fetchPageForUrl(url, { maxChars: MAX_CHARS, userAgent: USER_AGENT });
    const sdkText = page.text.split("\0").join("").replace(/\r\n/g, "\n").trim();
    const meta = await wikiPage(source.wiki);
    const text = meta.extract;
    if (text.length < 500) {
      throw new Error(`${source.slug} plaintext extract is only ${text.length} characters`);
    }
    const title = (meta.resolvedTitle ?? page.title ?? source.wiki).replace(/_/g, " ");
    const summary = leadSummary(text);
    const tags = meta.categories.length > 0 ? meta.categories : [source.slug];
    const keyEntities = entities(title, text.slice(0, 800), source.kind);
    const provenance = {
      summary: { model: "extractive-lead@1", pipeline: "extractive-lead", tool: TOOL, timestamp: stamped },
      tags: { model: "mediawiki-categories@1", pipeline: "mediawiki-categories", tool: TOOL, timestamp: stamped },
      key_entities: { model: "proper-noun-scan@1", pipeline: "proper-noun-scan", tool: TOOL, timestamp: stamped },
      classification: { model: "fixed-rule@1", pipeline: "fixed-rule", tool: TOOL, timestamp: stamped },
      language: { model: "fixed-rule@1", pipeline: "fixed-rule", tool: TOOL, timestamp: stamped },
    };

    const aco = await createACO({
      title,
      body: text,
      source_type: "link",
      author: AUTHOR,
      frontmatter: {
        corpus_slug: source.slug,
        source_url: page.url,
        summary,
        tags,
        key_entities: keyEntities,
        classification: "reference",
        language: "en",
        status: "final",
        visibility: "public",
        agent_accessible: true,
        rights: "CC-BY-SA-4.0",
        provenance,
      },
    });
    const validation = validateACO(aco.frontmatter);
    if (!validation.valid) {
      throw new Error(`${source.slug} invalid: ${JSON.stringify(validation.errors)}`);
    }
    await storage.putACO(aco);
    await writeFile(path.join(PAGES, `${source.slug}.txt`), text + "\n", "utf8");

    const id = String(aco.frontmatter["id"]);
    manifest.push({
      slug: source.slug,
      wiki: source.wiki,
      kind: source.kind,
      title,
      source_url: page.url,
      id,
      chars: text.length,
      revid: meta.revid ?? null,
      revision_timestamp: meta.revisionTimestamp ?? null,
      fetched_at: stamped,
      body_source: "mediawiki-extracts-explaintext",
      sdk_extractor: "fetchPageForUrl",
      sdk_extract_chars: sdkText.length,
      sdk_extract_prefix: sdkText.slice(0, 180),
      max_chars: MAX_CHARS,
    });
    leads.push({ slug: source.slug, title, summary, lead: text.slice(0, 700) });
    await sleep(200);
  }

  await writeFile(
    path.join(VAULT, ".acp", "config.json"),
    `${JSON.stringify(
      {
        vault_path: ".",
        author: AUTHOR,
        enrichment: { quality: "fast" },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(CORPUS, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(CORPUS, "leads.json"), `${JSON.stringify(leads, null, 2)}\n`, "utf8");
  process.stderr.write(`wrote ${manifest.length} pages\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
