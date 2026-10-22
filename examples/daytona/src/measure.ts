/**
 * Offline fork-scaling measurement. No network and no API keys.
 *
 * Tokenizer: cl100k_base, via `computeTokenCounts` in
 * `@atomic-content-protocol/core` (optional dependency `tiktoken`).
 * The benchmark fails if `cl100k` is missing. It does not fall back to the
 * chars/4 heuristic.
 *
 * Triage policy `mcp-find-similar-top3` (see policy.json and the README):
 * 1. `list_acos` returns every object's frontmatter. That JSON is the catalog.
 * 2. `find_similar` ranks the catalog with the MCP server's content-overlap
 *    fallback (title, tags, entity names, summary). Top 3 are opened.
 * 3. `read_aco` returns frontmatter plus body for those objects only.
 * Token counts use the pretty-printed JSON the MCP server writes on stdio
 * (`JSON.stringify(result, null, 2)` in `ACPMCPServer`).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeTokenCounts, FilesystemAdapter } from "@atomic-content-protocol/core";
import { buildUnifiedPrompt, estimateEnrichmentCost, pricingFor } from "@atomic-content-protocol/enrichment";
import { ACPMCPServer, type ToolOutput } from "@atomic-content-protocol/mcp";
import { contentQuery, EXAMPLE_ROOT, loadPolicy, promptPrefix, type Question } from "./policy.js";

const require = createRequire(import.meta.url);

function tiktokenVersion(): string {
  const entry = require.resolve("tiktoken");
  const pkg = JSON.parse(readFileSync(path.join(path.dirname(entry), "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

const READ_MODEL = "claude-haiku-4-5";
const ENRICH_DEPTH = "standard" as const;

export interface QuestionMeasurement {
  id: string;
  question: string;
  gold_slugs: string[];
  content_query: string;
  opened_slugs: string[];
  retrieval_hit: boolean;
  baseline_answer_supported: boolean;
  acp_answer_supported: boolean;
  baseline_tokens: number;
  acp_tokens: number;
  baseline_assembly_ms: number;
  acp_assembly_ms: number;
}

export interface ScaleRow {
  n: number;
  baseline_tokens: number;
  acp_tokens: number;
  tokens_saved: number;
  percent_saved: number;
  baseline_input_usd: number;
  acp_input_usd: number;
  usd_saved: number;
  retrieval_hit_rate: number;
  acp_answer_support_rate: number;
  baseline_answer_support_rate: number;
  baseline_assembly_ms: number;
  acp_assembly_ms: number;
}

export interface Measurement {
  tokenizer: string;
  tiktoken_version: string;
  read_model: string;
  input_usd_per_million: number;
  output_usd_per_million: number;
  policy: string;
  pages: number;
  questions: number;
  per_question: QuestionMeasurement[];
  scale: ScaleRow[];
  enrichment: {
    note: string;
    measured_prompt_input_tokens: number;
    estimated_output_tokens: number;
    estimated_output_source: string;
    package_estimate_usd: number;
    modeled_usd: number;
    measured_token_break_even_forks: number | null;
    modeled_usd_break_even_forks: number | null;
  };
}

interface ManifestEntry {
  slug: string;
  title: string;
}

function wire(result: ToolOutput): string {
  return JSON.stringify(result, null, 2);
}

async function cl100k(text: string): Promise<number> {
  const counts = await computeTokenCounts(text);
  if (counts.cl100k === undefined) {
    throw new Error("cl100k_base is unavailable. Install the tiktoken package and rerun.");
  }
  return counts.cl100k;
}

function usd(tokens: number, perMillion: number): number {
  return (tokens * perMillion) / 1_000_000;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function data(result: ToolOutput, tool: string): Record<string, unknown> {
  if (!result.success || result.data === null || result.data === undefined || typeof result.data !== "object") {
    throw new Error(`${tool} failed: ${result.error ?? "no data"}`);
  }
  return result.data as Record<string, unknown>;
}

function supports(haystack: string, expected: string): boolean {
  return haystack.toLowerCase().includes(expected.toLowerCase());
}

function sumAssigned(values: number[], n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += values[i % values.length] ?? 0;
  return total;
}

function rateAssigned(flags: boolean[], n: number): number {
  let hits = 0;
  for (let i = 0; i < n; i++) if (flags[i % flags.length]) hits += 1;
  return hits / n;
}

/** Smallest fork count whose cumulative saving covers `cost`. Null if not within `limit`. */
function breakEven(savedPerQuestion: number[], cost: number, limit = 100_000): number | null {
  if (cost <= 0) return 0;
  let saved = 0;
  for (let n = 1; n <= limit; n++) {
    saved += savedPerQuestion[(n - 1) % savedPerQuestion.length] ?? 0;
    if (saved >= cost) return n;
  }
  return null;
}

export async function measureCorpus(): Promise<Measurement> {
  const policy = loadPolicy();
  const pricing = pricingFor(READ_MODEL);
  if (!pricing) throw new Error(`No price for ${READ_MODEL} in MODEL_PRICING`);

  const questions = JSON.parse(readFileSync(path.join(EXAMPLE_ROOT, "corpus", "questions.json"), "utf8")) as Question[];
  const manifest = JSON.parse(
    readFileSync(path.join(EXAMPLE_ROOT, "corpus", "manifest.json"), "utf8")
  ) as ManifestEntry[];
  const pagesDir = path.join(EXAMPLE_ROOT, "corpus", "pages");
  const pages = manifest.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    body: readFileSync(path.join(pagesDir, `${entry.slug}.txt`), "utf8").replace(/\n$/, ""),
  }));

  const vault = path.join(EXAMPLE_ROOT, "corpus", "vault");
  const server = new ACPMCPServer({ storage: new FilesystemAdapter(vault) });
  const listResult = await server.callTool("list_acos", { limit: 50, sortBy: "title", order: "asc" });
  const listData = data(listResult, "list_acos");
  const items = listData["items"];
  if (!Array.isArray(items) || items.length !== pages.length) {
    throw new Error(`list_acos returned ${Array.isArray(items) ? items.length : "no"} items, expected ${pages.length}`);
  }
  const slugById = new Map<string, string>();
  for (const item of items) {
    const fm = item as Record<string, unknown>;
    slugById.set(String(fm["id"]), String(fm["corpus_slug"]));
  }
  const catalogWire = wire(listResult);

  const bodies = pages.map((page) => `# ${page.title}\n\n${page.body}`).join("\n\n");
  const baselineMaterial = `${policy.sections.pages}${bodies}`;

  const perQuestion: QuestionMeasurement[] = [];
  for (const question of questions) {
    const query = contentQuery(question.question, policy.stopwords);
    if (query.length === 0) throw new Error(`${question.id} has no content words`);

    const prefix = promptPrefix(policy, question.question);
    const baselinePrompt = `${prefix}${baselineMaterial}`;
    const baselineStarted = performance.now();
    const baselineTokens = await cl100k(baselinePrompt);
    const baselineMs = performance.now() - baselineStarted;

    const similarResult = await server.callTool("find_similar", {
      text: query,
      limit: policy.limit,
      threshold: policy.threshold,
    });
    const similarData = data(similarResult, "find_similar");
    if (similarData["method"] !== "content_overlap") {
      throw new Error(`${question.id}: find_similar used ${String(similarData["method"])}, expected content_overlap`);
    }
    const results = similarData["results"];
    if (!Array.isArray(results)) throw new Error(`${question.id}: find_similar returned no results array`);
    const openedIds = results.map((row) => String((row as Record<string, unknown>)["id"]));
    const openedSlugs = openedIds.map((id) => {
      const slug = slugById.get(id);
      if (!slug) throw new Error(`find_similar returned unknown id ${id}`);
      return slug;
    });

    const reads: ToolOutput[] = [];
    for (const id of openedIds) {
      reads.push(await server.callTool("read_aco", { id }));
    }
    const acpPrompt = `${prefix}${policy.sections.catalog}${catalogWire}\n\n${policy.sections.ranking}${wire(similarResult)}\n\n${policy.sections.opened}${reads.map(wire).join("\n\n")}`;
    const acpStarted = performance.now();
    const acpTokens = await cl100k(acpPrompt);
    const acpMs = performance.now() - acpStarted;

    const openedBodies = reads
      .map((result) => {
        const body = data(result, "read_aco")["body"];
        return typeof body === "string" ? body : "";
      })
      .join("\n");
    const retrievalHit = question.gold_slugs.every((slug) => openedSlugs.includes(slug));

    perQuestion.push({
      id: question.id,
      question: question.question,
      gold_slugs: question.gold_slugs,
      content_query: query,
      opened_slugs: openedSlugs,
      retrieval_hit: retrievalHit,
      baseline_answer_supported: supports(baselinePrompt, question.expected_answer),
      acp_answer_supported: supports(`${catalogWire}\n${openedBodies}`, question.expected_answer),
      baseline_tokens: baselineTokens,
      acp_tokens: acpTokens,
      baseline_assembly_ms: Number(baselineMs.toFixed(2)),
      acp_assembly_ms: Number(acpMs.toFixed(2)),
    });
  }

  let measuredInput = 0;
  let estimatedOutput = 0;
  let packageUsd = 0;
  for (const page of pages) {
    measuredInput += await cl100k(buildUnifiedPrompt(page.title, page.body));
    const estimate = estimateEnrichmentCost(page.body, ENRICH_DEPTH, { model: READ_MODEL });
    estimatedOutput += estimate.outputTokens;
    packageUsd += estimate.cost;
  }
  const modeledUsd = usd(measuredInput, pricing.input) + usd(estimatedOutput, pricing.output);

  const savedTokens = perQuestion.map((row) => row.baseline_tokens - row.acp_tokens);
  const savedUsd = savedTokens.map((tokens) => usd(tokens, pricing.input));

  const scale: ScaleRow[] = policy.fork_sizes.map((n) => {
    const baselineTokens = sumAssigned(
      perQuestion.map((row) => row.baseline_tokens),
      n
    );
    const acpTokens = sumAssigned(
      perQuestion.map((row) => row.acp_tokens),
      n
    );
    const saved = baselineTokens - acpTokens;
    return {
      n,
      baseline_tokens: baselineTokens,
      acp_tokens: acpTokens,
      tokens_saved: saved,
      percent_saved: baselineTokens === 0 ? 0 : (saved / baselineTokens) * 100,
      baseline_input_usd: roundUsd(usd(baselineTokens, pricing.input)),
      acp_input_usd: roundUsd(usd(acpTokens, pricing.input)),
      usd_saved: roundUsd(usd(saved, pricing.input)),
      retrieval_hit_rate: rateAssigned(
        perQuestion.map((row) => row.retrieval_hit),
        n
      ),
      acp_answer_support_rate: rateAssigned(
        perQuestion.map((row) => row.acp_answer_supported),
        n
      ),
      baseline_answer_support_rate: rateAssigned(
        perQuestion.map((row) => row.baseline_answer_supported),
        n
      ),
      baseline_assembly_ms: Number(
        sumAssigned(
          perQuestion.map((row) => row.baseline_assembly_ms),
          n
        ).toFixed(2)
      ),
      acp_assembly_ms: Number(
        sumAssigned(
          perQuestion.map((row) => row.acp_assembly_ms),
          n
        ).toFixed(2)
      ),
    };
  });

  return {
    tokenizer: "cl100k_base",
    tiktoken_version: tiktokenVersion(),
    read_model: READ_MODEL,
    input_usd_per_million: pricing.input,
    output_usd_per_million: pricing.output,
    policy: policy.name,
    pages: pages.length,
    questions: questions.length,
    per_question: perQuestion,
    scale,
    enrichment: {
      note: "Committed ACO metadata is extractive (Wikipedia lead, MediaWiki categories, a proper-noun scan). No model was called, so measured model spend for this corpus is $0. The figures below are the size of the real UnifiedPipeline prompt plus the package's estimated output, priced with MODEL_PRICING. They are not an invoice. buildUnifiedPrompt truncates each body to 4000 characters, which is what that prompt builder sends. A job that uploaded every full page would be larger.",
      measured_prompt_input_tokens: measuredInput,
      estimated_output_tokens: estimatedOutput,
      estimated_output_source: `estimateEnrichmentCost(..., "${ENRICH_DEPTH}") outputTokens constant, not a completion`,
      package_estimate_usd: roundUsd(packageUsd),
      modeled_usd: roundUsd(modeledUsd),
      measured_token_break_even_forks: breakEven(savedTokens, measuredInput),
      modeled_usd_break_even_forks: breakEven(savedUsd, modeledUsd),
    },
  };
}

function int(value: number): string {
  return value.toLocaleString("en-US");
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function renderMarkdown(result: Measurement): string {
  const questionRows = result.per_question
    .map((row) => {
      const saved = row.baseline_tokens - row.acp_tokens;
      const savedPct = row.baseline_tokens === 0 ? 0 : (saved / row.baseline_tokens) * 100;
      return `| ${row.id} | ${int(row.baseline_tokens)} | ${int(row.acp_tokens)} | ${pct(savedPct)} | ${row.opened_slugs.join(", ")} | ${row.retrieval_hit ? "yes" : "no"} | ${row.acp_answer_supported ? "yes" : "no"} |`;
    })
    .join("\n");

  const scaleRows = result.scale
    .map(
      (row) =>
        `| ${row.n} | ${int(row.baseline_tokens)} | ${int(row.acp_tokens)} | ${int(row.tokens_saved)} | ${pct(row.percent_saved)} | ${money(row.baseline_input_usd)} | ${money(row.acp_input_usd)} | ${money(row.usd_saved)} | ${pct(row.retrieval_hit_rate * 100)} | ${pct(row.acp_answer_support_rate * 100)} | ${pct(row.baseline_answer_support_rate * 100)} |`
    )
    .join("\n");

  const enrich = result.enrichment;
  const forks = (count: number | null): string => {
    if (count === null) return "not reached within 100,000 forks";
    return count === 1 ? "1 fork" : `${count} forks`;
  };
  const tokenBe = forks(enrich.measured_token_break_even_forks);
  const usdBe = forks(enrich.modeled_usd_break_even_forks);

  return `# Daytona ACP offline benchmark

Tokenizer: \`${result.tokenizer}\` (tiktoken ${result.tiktoken_version}), counted with \`computeTokenCounts\` from \`@atomic-content-protocol/core\`.

Policy: \`${result.policy}\`. Each question sends \`list_acos\` frontmatter for all ${result.pages} objects, \`find_similar\` content-overlap, and \`read_aco\` for the top ${3} hits. The baseline sends every cached page body. The question bank has ${result.questions} questions. Fork counts above that cycle the bank (\`question i % ${result.questions}\`).

Prices used for the dollar columns are \`MODEL_PRICING["${result.read_model}"]\` input at $${result.input_usd_per_million} per million tokens. Output tokens are not included, because this run does not call a model. These are not invoices.

The repository README's 86% illustration (250,000 tokens down to 35,000 on 50 documents) is a different hypothetical. It is not this measurement.

## Per question

| Question | Baseline tokens | ACP tokens | Saved | Opened | Gold page opened | Answer string in ACP context |
|---|---:|---:|---:|---|---|---|
${questionRows}

## Fork scaling

Assembly time is local tokenization time, summed across the N assignments (a repeated question adds its measured time again). It is not sandbox boot time and not model latency.

| N | Baseline tokens | ACP tokens | Saved | Saved % | Baseline input $ | ACP input $ | $ saved | Retrieval hit | ACP answer support | Baseline answer support |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${scaleRows}

![Context tokens by fork count](scaling.svg)

## Enrichment, counted once

${enrich.note}

| Item | Value |
|---|---|
| Measured UnifiedPipeline prompt input tokens (cl100k) | ${int(enrich.measured_prompt_input_tokens)} |
| Estimated output tokens | ${int(enrich.estimated_output_tokens)} |
| Estimated output source | ${enrich.estimated_output_source} |
| Package \`estimateEnrichmentCost\` total (approximate tokenizer) | ${money(enrich.package_estimate_usd)} |
| Modeled fast-tier USD (measured input + estimated output) | ${money(enrich.modeled_usd)} |
| Break-even on measured tokens (savings vs measured prompt input) | ${tokenBe} |
| Break-even on modeled USD (input-only read savings vs modeled enrichment) | ${usdBe} |
| Model spend that produced the committed metadata | $0 |

A break-even of 0 forks means the measured per-fork token saving already exceeds the one-time prompt, or the cost being compared is zero.

## Accuracy

Retrieval hit means every gold page for that question was one of the opened objects. Answer support means the expected answer string occurs in the context (baseline: full pages; ACP: the metadata catalog plus opened bodies). This is not a model grade. A live model can still answer wrongly from a context that contains the string.

## Caveats

- Page bodies are MediaWiki plaintext extracts, capped at 100,000 characters. \`fetchPageForUrl\` was also run; on these Wikipedia HTML pages it returns chrome and wikitext, which is recorded on the manifest and is not the body.
- Metadata was not produced by \`UnifiedPipeline\`. A model summary could be shorter or longer, and could rank differently.
- Cycling 20 questions to N=100 repeats the same work. It shows the fork curve, not 100 distinct questions.
- Input-only dollar savings ignore output tokens. Similar answer lengths on both sides would add about the same output cost to each and would not remove the input gap.
- Baseline prompts for this corpus are larger than a typical 200k-token context window. Stuffing every page into one call is what the token count measures. A live provider may reject that call. See the live harness.
`;
}

export function renderSvg(rows: ScaleRow[]): string {
  const width = 720;
  const height = 420;
  const pad = { left: 78, right: 24, top: 46, bottom: 54 };
  const maxX = 100;
  const maxY = Math.max(...rows.flatMap((row) => [row.baseline_tokens, row.acp_tokens]), 1);
  const xOf = (n: number) => pad.left + (n / maxX) * (width - pad.left - pad.right);
  const yOf = (value: number) => pad.top + (1 - value / maxY) * (height - pad.top - pad.bottom);
  const points = (key: "baseline_tokens" | "acp_tokens") =>
    rows.map((row) => `${xOf(row.n).toFixed(1)},${yOf(row[key]).toFixed(1)}`).join(" ");
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = maxY * fraction;
    const y = yOf(value);
    const label = `${(value / 1_000_000).toFixed(2)}M`;
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="#e5e7eb" />
  <text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#374151">${label}</text>`;
  });
  const xLabels = rows
    .map(
      (row) =>
        `<text x="${xOf(row.n).toFixed(1)}" y="${height - 18}" text-anchor="middle" font-size="12" fill="#374151">${row.n}</text>`
    )
    .join("\n  ");
  const dots = (key: "baseline_tokens" | "acp_tokens", color: string) =>
    rows
      .map((row) => `<circle cx="${xOf(row.n).toFixed(1)}" cy="${yOf(row[key]).toFixed(1)}" r="4" fill="${color}" />`)
      .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${pad.left}" y="28" font-size="16" font-family="sans-serif" fill="#111827">Context tokens by fork count</text>
  <text x="${width - pad.right - 48}" y="28" text-anchor="end" font-size="12" font-family="sans-serif" fill="#b45309">Baseline</text>
  <text x="${width - pad.right}" y="28" text-anchor="end" font-size="12" font-family="sans-serif" fill="#0f766e">ACP</text>
  ${yTicks.join("\n  ")}
  <polyline fill="none" stroke="#b45309" stroke-width="2" points="${points("baseline_tokens")}"/>
  <polyline fill="none" stroke="#0f766e" stroke-width="2" points="${points("acp_tokens")}"/>
  ${dots("baseline_tokens", "#b45309")}
  ${dots("acp_tokens", "#0f766e")}
  ${xLabels}
  <text x="${(pad.left + (width - pad.right)) / 2}" y="${height - 2}" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#374151">Forks (N)</text>
</svg>
`;
}

async function main(): Promise<void> {
  const result = await measureCorpus();
  const resultsDir = path.join(EXAMPLE_ROOT, "results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, "offline.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(path.join(resultsDir, "offline.md"), renderMarkdown(result));
  writeFileSync(path.join(resultsDir, "scaling.svg"), renderSvg(result.scale));
  const scale = result.scale.map((row) => `${row.n}:${row.percent_saved.toFixed(1)}%`).join(" ");
  console.log(`wrote results (saved by N: ${scale})`);
  console.log(
    `enrichment prompt tokens ${result.enrichment.measured_prompt_input_tokens}, token break-even ${result.enrichment.measured_token_break_even_forks}`
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
