/**
 * Offline fork-scaling measurement. No network and no API keys.
 *
 * Tokenizer: cl100k_base, via `computeTokenCounts` in
 * `@atomic-content-protocol/core` (optional dependency `tiktoken`).
 * The benchmark fails if `cl100k` is missing. It does not fall back to the
 * chars/4 heuristic.
 *
 * Headline policy `summary-first` (see policy.json and the README):
 * 1. Okapi BM25 over title, summary, and tags only (not the body, not entities).
 *    The model is shown those few compact summaries, not the full catalog.
 * 2. Offline cannot call the model. A conservative proxy opens the top body
 *    unless the top candidate's title, summary, and tags contain every
 *    query term and the next score is not close. It opens the top 2 when
 *    scores are close, and never more than 2. Variant `summary-first-v1`
 *    keeps the old term-coverage rule.
 * Token total is cl100k(decision prompt) plus, when a body opens,
 * cl100k(follow-up prompt). No model is called.
 *
 * Variant `mcp-find-similar-top3` is still measured:
 * 1. `list_acos` returns every object's frontmatter. That JSON is the catalog.
 * 2. `find_similar` ranks with content-overlap. Top 3 are opened.
 * 3. `read_aco` returns frontmatter plus body as pretty JSON.
 * The MCP server cannot return compact summaries for a filtered id set, so
 * summary-first uses the local helper in sandbox/bm25.mjs.
 *
 * Two baselines:
 * - Naive full-read is an upper bound. The prompt contains every page body.
 * - Search-then-read runs Okapi BM25 over the raw page text, keeps the top 3,
 *   and charges the title/URL index, the ranking, and those full pages only.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeTokenCounts, FilesystemAdapter } from "@atomic-content-protocol/core";
import { buildUnifiedPrompt, estimateEnrichmentCost, pricingFor } from "@atomic-content-protocol/enrichment";
import { ACPMCPServer } from "@atomic-content-protocol/mcp";
import { BM25_B, BM25_K1 } from "../sandbox/bm25.mjs";
import { EXAMPLE_ROOT, loadPolicy, type Question } from "./policy.js";
import {
  breakEven,
  type QuestionMeasurement,
  roundUsd,
  type ScaleRow,
  scaleRow,
  scoreCorpus,
  type ToolRunner,
  usd,
} from "./score.js";

export type { QuestionMeasurement, ScaleRow };

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

export interface Measurement {
  tokenizer: string;
  tiktoken_version: string;
  read_model: string;
  bm25: { k1: number; b: number };
  input_usd_per_million: number;
  output_usd_per_million: number;
  policy: string;
  legacy_policy: string;
  summary_first: {
    k: number;
    max_bodies: number;
    close_score_ratio: number;
    runner_up_cover_fraction: number;
    rank: string;
    proxy: string;
  };
  summary_first_v1: { name: string; k: number; max_bodies: number; cover_fraction: number };
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
    measured_token_break_even_vs_search_forks: number | null;
    modeled_usd_break_even_vs_search_forks: number | null;
    legacy_measured_token_break_even_forks: number | null;
    legacy_measured_token_break_even_vs_search_forks: number | null;
    v1_measured_token_break_even_vs_search_forks: number | null;
  };
}

interface ManifestEntry {
  slug: string;
  title: string;
  source_url: string;
}

const WIKI_NOTE =
  "Committed ACO metadata is extractive (Wikipedia lead, MediaWiki categories, a proper-noun scan). No model was called, so measured model spend for this corpus is $0. The figures below are the size of the real UnifiedPipeline prompt plus the package's estimated output, priced with MODEL_PRICING. They are not an invoice. buildUnifiedPrompt truncates each body to 4000 characters, which is what that prompt builder sends. A job that uploaded every full page would be larger. Break-even for the headline summary-first policy is against the naive full-read (an upper bound) and against search-then-read. The legacy catalog policy has its own break-even rows. Null means that policy did not accumulate a token saving against that arm within 100,000 forks.";

async function cl100k(text: string): Promise<number> {
  const counts = await computeTokenCounts(text);
  if (counts.cl100k === undefined) {
    throw new Error("cl100k_base is unavailable. Install the tiktoken package and rerun.");
  }
  return counts.cl100k;
}

export async function measureCorpus(root = EXAMPLE_ROOT, metadataNote = WIKI_NOTE): Promise<Measurement> {
  const policy = loadPolicy(root);
  if (policy.name !== "summary-first") throw new Error(`headline policy must be summary-first, got ${policy.name}`);
  if (!policy.legacy_name) throw new Error("policy.legacy_name is required");
  if (!(policy.summary_k > 0) || !(policy.max_bodies > 0) || !(policy.v1_max_bodies > 0) || !(policy.cover_fraction > 0)) {
    throw new Error("summary_k, max_bodies, v1_max_bodies, and cover_fraction must be positive");
  }
  if (policy.v1_name !== "summary-first-v1") throw new Error(`v1 policy must be summary-first-v1, got ${policy.v1_name}`);
  const pricing = pricingFor(READ_MODEL);
  if (!pricing) throw new Error(`No price for ${READ_MODEL} in MODEL_PRICING`);

  const questions = JSON.parse(readFileSync(path.join(root, "corpus", "questions.json"), "utf8")) as Question[];
  const manifest = JSON.parse(readFileSync(path.join(root, "corpus", "manifest.json"), "utf8")) as ManifestEntry[];
  const pagesDir = path.join(root, "corpus", "pages");
  const pages = manifest.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    url: entry.source_url,
    body: readFileSync(path.join(pagesDir, `${entry.slug}.txt`), "utf8").replace(/\n$/, ""),
  }));
  const vault = path.join(root, "corpus", "vault");
  const server = new ACPMCPServer({ storage: new FilesystemAdapter(vault) });
  const tools: ToolRunner = {
    listAcos: (args) => server.callTool("list_acos", args),
    findSimilar: (args) => server.callTool("find_similar", args),
    readAco: (args) => server.callTool("read_aco", args),
  };
  const scored = await scoreCorpus({ policy, questions, pages, tools, countTokens: cl100k });
  const perQuestion = scored.perQuestion;

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
  const savedVsSearch = perQuestion.map((row) => row.search_tokens - row.acp_tokens);
  const savedUsd = savedTokens.map((tokens) => usd(tokens, pricing.input));
  const savedUsdVsSearch = savedVsSearch.map((tokens) => usd(tokens, pricing.input));
  const legacySavedTokens = perQuestion.map((row) => row.baseline_tokens - row.legacy_tokens);
  const legacySavedVsSearch = perQuestion.map((row) => row.search_tokens - row.legacy_tokens);
  const v1SavedVsSearch = perQuestion.map((row) => row.search_tokens - row.v1_tokens);

  const scale = policy.fork_sizes.map((n) => scaleRow(perQuestion, n, pricing.input));

  return {
    tokenizer: "cl100k_base",
    tiktoken_version: tiktokenVersion(),
    read_model: READ_MODEL,
    bm25: { k1: BM25_K1, b: BM25_B },
    input_usd_per_million: pricing.input,
    output_usd_per_million: pricing.output,
    policy: policy.name,
    legacy_policy: policy.legacy_name,
    summary_first: {
      k: policy.summary_k,
      max_bodies: policy.max_bodies,
      close_score_ratio: policy.close_score_ratio,
      runner_up_cover_fraction: policy.runner_up_cover_fraction,
      rank: "bm25-title-summary-tags",
      proxy:
        "open the top body unless every query term is in the top candidate's title, summary, and tags, the runner-up covers a smaller share than runner_up_cover_fraction, and the score ratio is below close_score_ratio; open the top 2 when the scores are that close; never more than max_bodies. The proxy does not read the expected answer.",
    },
    summary_first_v1: {
      name: policy.v1_name,
      k: policy.summary_k,
      max_bodies: policy.v1_max_bodies,
      cover_fraction: policy.cover_fraction,
    },
    pages: pages.length,
    questions: questions.length,
    per_question: perQuestion,
    scale,
    enrichment: {
      note: metadataNote,
      measured_prompt_input_tokens: measuredInput,
      estimated_output_tokens: estimatedOutput,
      estimated_output_source: `estimateEnrichmentCost(..., "${ENRICH_DEPTH}") outputTokens constant, not a completion`,
      package_estimate_usd: roundUsd(packageUsd),
      modeled_usd: roundUsd(modeledUsd),
      measured_token_break_even_forks: breakEven(savedTokens, measuredInput),
      modeled_usd_break_even_forks: breakEven(savedUsd, modeledUsd),
      measured_token_break_even_vs_search_forks: breakEven(savedVsSearch, measuredInput),
      modeled_usd_break_even_vs_search_forks: breakEven(savedUsdVsSearch, modeledUsd),
      legacy_measured_token_break_even_forks: breakEven(legacySavedTokens, measuredInput),
      legacy_measured_token_break_even_vs_search_forks: breakEven(legacySavedVsSearch, measuredInput),
      v1_measured_token_break_even_vs_search_forks: breakEven(v1SavedVsSearch, measuredInput),
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

function yn(flag: boolean): string {
  return flag ? "yes" : "no";
}

function slugList(slugs: string[]): string {
  return slugs.length === 0 ? "(none)" : slugs.join(", ");
}

export function renderMarkdown(result: Measurement): string {
  const tokenRows = result.per_question
    .map((row) => {
      return `| ${row.id} | ${int(row.baseline_tokens)} | ${int(row.search_tokens)} | ${int(row.summary_decision_tokens)} | ${int(row.summary_body_tokens)} | ${int(row.acp_tokens)} | ${int(row.v1_tokens)} | ${int(row.legacy_tokens)} |`;
    })
    .join("\n");

  const retrievalRows = result.per_question
    .map((row) => {
      return `| ${row.id} | ${slugList(row.search_opened_slugs)} | ${slugList(row.candidate_slugs)} | ${row.decision} | ${slugList(row.opened_slugs)} | ${row.v1_decision} | ${slugList(row.v1_opened_slugs)} | ${yn(row.search_retrieval_hit)} | ${yn(row.retrieval_hit)} | ${yn(row.v1_retrieval_hit)} | ${yn(row.search_answer_supported)} | ${yn(row.acp_answer_supported)} | ${yn(row.v1_answer_supported)} |`;
    })
    .join("\n");

  const scaleRows = result.scale
    .map((row) => {
      return `| ${row.n} | ${int(row.baseline_tokens)} | ${int(row.search_tokens)} | ${int(row.acp_tokens)} | ${int(row.v1_tokens)} | ${int(row.legacy_tokens)} | ${pct(row.percent_saved_vs_search)} | ${pct(row.v1_percent_saved_vs_search)} | ${pct(row.legacy_percent_saved_vs_search)} | ${money(row.search_input_usd)} | ${money(row.acp_input_usd)} | ${money(row.v1_input_usd)} | ${money(row.legacy_input_usd)} |`;
    })
    .join("\n");

  const rateRows = result.scale
    .map((row) => {
      return `| ${row.n} | ${pct(row.search_retrieval_hit_rate * 100)} | ${pct(row.retrieval_hit_rate * 100)} | ${pct(row.v1_retrieval_hit_rate * 100)} | ${pct(row.search_answer_support_rate * 100)} | ${pct(row.acp_answer_support_rate * 100)} | ${pct(row.v1_answer_support_rate * 100)} | ${pct(row.legacy_answer_support_rate * 100)} |`;
    })
    .join("\n");

  const enrich = result.enrichment;
  const forks = (count: number | null): string => {
    if (count === null) return "not reached within 100,000 forks";
    return count === 1 ? "1 fork" : `${count} forks`;
  };
  const rule = result.summary_first;
  const v1 = result.summary_first_v1;
  const fromSummaries = result.per_question.filter((row) => row.decision === "answer").length;

  return `# Daytona ACP offline benchmark

Tokenizer: \`${result.tokenizer}\` (tiktoken ${result.tiktoken_version}), counted with \`computeTokenCounts\` from \`@atomic-content-protocol/core\`.

Headline policy: \`${result.policy}\`. BM25 (k1=${result.bm25.k1}, b=${result.bm25.b}) ranks title, summary, and tags only, and keeps the top ${rule.k}. The decision prompt shows those compact summaries and asks for an answer or \`OPEN slug\`. Offline cannot call the model, so a conservative proxy decides. It opens the top body unless every query term is in the top candidate's title, summary, and tags, the runner-up covers less than ${rule.runner_up_cover_fraction} of those terms, and the second score is below ${rule.close_score_ratio} of the first. When the top two scores are that close it opens both. It never opens more than ${rule.max_bodies} bodies. The proxy does not read the expected answer. On this question bank, ${fromSummaries} of ${result.questions} questions stayed on summaries. Summary-first tokens are two cl100k encodings added together: the decision prompt, plus a second prompt (instruction, question, and opened markdown) when a body is opened.

Variant \`${v1.name}\` is the previous term-coverage rule, kept for comparison and not retuned: a candidate covers when at least max(1, ceil(unique query terms * ${v1.cover_fraction})) of those terms appear in its title, summary, or tags. If any of the top ${v1.k} covers, no body is opened. Otherwise up to ${v1.max_bodies} bodies are opened. Its token total is the decision prompt (including the decision line) plus the opened markdown, the same two encodings as before.

Variant \`${result.legacy_policy}\` still puts \`list_acos\` frontmatter for all ${result.pages} objects in the prompt, plus \`find_similar\` content-overlap and \`read_aco\` JSON for the top 3. That variant is reported so the catalog cost stays visible.

Search-then-read runs the same BM25 settings over the raw title plus body, then sends the title and URL index, the top 3 ranking, and those full pages. Naive full-read sends every cached page body. It is an upper bound, not what a careful agent does. The question bank has ${result.questions} questions. Fork counts above that cycle the bank (\`question i % ${result.questions}\`).

Prices used for the dollar columns are \`MODEL_PRICING["${result.read_model}"]\` input at $${result.input_usd_per_million} per million tokens, applied to the measured cl100k totals. Output tokens are not included, because this run does not call a model. The decision line is priced as input, because it is text in the decision prompt. These are not invoices.

A positive "summary-first vs search" percent means summary-first used fewer input tokens than search-then-read. A negative percent means it used more. The same reading applies to the v1 and legacy columns. Savings against the naive full-read are an upper bound.

The repository README's 86% illustration (250,000 tokens down to 35,000 on 50 documents) is a different hypothetical. It is not this measurement.

## Per question tokens

| Question | Naive | Search | Summary decision | Summary bodies | Summary-first | v1 | Legacy ACP |
|---|---:|---:|---:|---:|---:|---:|---:|
${tokenRows}

## Per question retrieval

Summary-first hit and v1 hit mean every gold slug is in the top-${rule.k} summary candidates. They do not mean the body was opened. Search hit and legacy hit mean every gold slug was opened. Answer support means the expected string is in that arm's shown context: search material, summary-first summaries plus opened markdown (not the question), the v1 summaries plus the bodies that rule opened, or the legacy catalog plus opened JSON bodies. None of these is a model grade.

| Question | Search opened | Summary candidates | Decision | Summary bodies | v1 decision | v1 bodies | Search hit | Summary hit | v1 hit | Search answer | Summary answer | v1 answer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${retrievalRows}

## Fork scaling

Assembly time in the JSON is local tokenization time, summed across the N assignments. It is not sandbox boot time and not model latency.

| N | Naive tokens | Search tokens | Summary-first tokens | v1 tokens | Legacy tokens | Summary vs search | v1 vs search | Legacy vs search | Search $ | Summary $ | v1 $ | Legacy $ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${scaleRows}

| N | Search hit | Summary hit | v1 hit | Search answer | Summary answer | v1 answer | Legacy answer |
|---:|---:|---:|---:|---:|---:|---:|---:|
${rateRows}

![Context tokens by fork count](scaling.svg)

![Summary-first, v1, legacy ACP, and search-then-read](scaling-search.svg)

The first chart uses the naive upper bound as its scale, so the other lines sit near the bottom. The second chart is search-then-read, summary-first, and the legacy catalog policy.

## Enrichment, counted once

${enrich.note}

| Item | Value |
|---|---|
| Measured UnifiedPipeline prompt input tokens (cl100k) | ${int(enrich.measured_prompt_input_tokens)} |
| Estimated output tokens | ${int(enrich.estimated_output_tokens)} |
| Estimated output source | ${enrich.estimated_output_source} |
| Package \`estimateEnrichmentCost\` total (approximate tokenizer) | ${money(enrich.package_estimate_usd)} |
| Modeled fast-tier USD (measured input + estimated output) | ${money(enrich.modeled_usd)} |
| Summary-first break-even vs naive full-read, measured tokens | ${forks(enrich.measured_token_break_even_forks)} |
| Summary-first break-even vs naive full-read, modeled USD | ${forks(enrich.modeled_usd_break_even_forks)} |
| Summary-first break-even vs search-then-read, measured tokens | ${forks(enrich.measured_token_break_even_vs_search_forks)} |
| Summary-first break-even vs search-then-read, modeled USD | ${forks(enrich.modeled_usd_break_even_vs_search_forks)} |
| Legacy catalog break-even vs naive full-read, measured tokens | ${forks(enrich.legacy_measured_token_break_even_forks)} |
| Legacy catalog break-even vs search-then-read, measured tokens | ${forks(enrich.legacy_measured_token_break_even_vs_search_forks)} |
| Summary-first v1 break-even vs search-then-read, measured tokens | ${forks(enrich.v1_measured_token_break_even_vs_search_forks)} |
| Model spend that produced the committed metadata | $0 |

A break-even of 0 forks means the measured per-fork token saving already exceeds the one-time prompt, or the cost being compared is zero. "Not reached" means that arm never saves tokens against the comparison, so enrichment is not paid back by the read path.

## Accuracy

Summary-first retrieval hit means every gold page was one of the summary candidates. Answer support means the expected answer string occurs in the compact summaries or in a markdown body the proxy opened. The v1 column uses the old coverage rule for which bodies open. Legacy retrieval hit means every gold page was opened by \`find_similar\`. This is not a model grade. A live model can still answer wrongly from a context that contains the string. The recorded live docs run used v1, and its model answers were less accurate than search-then-read.

## Caveats

- Naive full-read is an upper bound. Search-then-read is the realistic baseline: BM25 over raw text, top 3.
- Summary-first does not put the full metadata catalog in the prompt. The MCP server's \`find_similar\` returns only id, title, and similarity_score. \`list_acos\` returns every object's full frontmatter and cannot return compact summaries for a filtered id set. \`read_aco\` returns pretty JSON, not markdown. A small SDK addition that would match this policy is \`read_summaries({ ids })\` returning \`{ id, title, summary }[]\`, plus a markdown format on \`read_aco\`. This demo ranks frontmatter with the local helper and opens markdown from the page cache. It does not change SDK packages.
- The offline headline decision is the proxy above, not a Haiku completion. A live run sends the summaries and lets the model answer or reply OPEN. When that reply is missing or uncertain, the harness opens the same bodies the proxy would. v1 still sends one concatenated call with the coverage decision already written in. Provider usage can differ from these cl100k sums.
- Page bodies for the Wikipedia corpus are MediaWiki plaintext extracts, capped at 100,000 characters. \`fetchPageForUrl\` on those HTML pages returns chrome and wikitext, which is recorded on the manifest and is not the body. The docs demo uses markdown fetched from the docs index. That raw text is not committed. \`src/build-docs.ts\` regenerates it locally.
- Metadata was not produced by \`UnifiedPipeline\`. A model summary could be shorter or longer, and could rank differently.
- Cycling the question bank out to N=100 repeats the same work. It shows the fork curve, not that many distinct questions.
- Input-only dollar figures ignore model output tokens. Similar answer lengths on both sides would add about the same output cost to each and would not remove the input gap.
- Naive prompts for the Wikipedia corpus are larger than a typical 200k-token context window. The live harness uses search-then-read as the non-ACP arm by default. Set \`ACP_LIVE_BASELINE=naive\` or \`both\` to also send the upper bound. The ACP arm of a live run is summary-first.
`;
}

export type SeriesKey = "baseline_tokens" | "search_tokens" | "acp_tokens" | "legacy_tokens" | "v1_tokens";

export function renderSvg(
  rows: ScaleRow[],
  title: string,
  series: Array<{ key: SeriesKey; color: string; label: string }>
): string {
  const width = 720;
  const height = 420;
  const pad = { left: 78, right: 24, top: 72, bottom: 54 };
  const maxX = 100;
  const maxY = Math.max(...rows.flatMap((row) => series.map((item) => Number(row[item.key]))), 1);
  const xOf = (n: number) => pad.left + (n / maxX) * (width - pad.left - pad.right);
  const yOf = (value: number) => pad.top + (1 - value / maxY) * (height - pad.top - pad.bottom);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = maxY * fraction;
    const y = yOf(value);
    const label = value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : `${Math.round(value / 1000)}k`;
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="#e5e7eb" />
  <text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#374151">${label}</text>`;
  });
  const xLabels = rows
    .map(
      (row) =>
        `<text x="${xOf(row.n).toFixed(1)}" y="${height - 18}" text-anchor="middle" font-size="12" fill="#374151">${row.n}</text>`
    )
    .join("\n  ");
  const lines = series
    .map((item) => {
      const points = rows.map((row) => `${xOf(row.n).toFixed(1)},${yOf(Number(row[item.key])).toFixed(1)}`).join(" ");
      const dots = rows
        .map(
          (row) =>
            `<circle cx="${xOf(row.n).toFixed(1)}" cy="${yOf(Number(row[item.key])).toFixed(1)}" r="4" fill="${item.color}" />`
        )
        .join("\n  ");
      return `<polyline fill="none" stroke="${item.color}" stroke-width="2" points="${points}"/>\n  ${dots}`;
    })
    .join("\n  ");
  const legend = series
    .map(
      (item, index) =>
        `<text x="${width - pad.right}" y="${18 + index * 16}" text-anchor="end" font-size="12" font-family="sans-serif" fill="${item.color}">${item.label}</text>`
    )
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${pad.left}" y="22" font-size="16" font-family="sans-serif" fill="#111827">${title}</text>
  ${legend}
  ${yTicks.join("\n  ")}
  ${lines}
  ${xLabels}
  <text x="${(pad.left + (width - pad.right)) / 2}" y="${height - 2}" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#374151">Forks (N)</text>
</svg>
`;
}

export const NAIVE_SERIES: Array<{ key: SeriesKey; color: string; label: string }> = [
  { key: "baseline_tokens", color: "#b45309", label: "Naive full-read (upper bound)" },
  { key: "search_tokens", color: "#1d4ed8", label: "Search-then-read" },
  { key: "acp_tokens", color: "#0f766e", label: "Summary-first ACP" },
];

export const COMPARISON_SERIES: Array<{ key: SeriesKey; color: string; label: string }> = [
  { key: "search_tokens", color: "#1d4ed8", label: "Search-then-read" },
  { key: "acp_tokens", color: "#0f766e", label: "Summary-first ACP" },
  { key: "v1_tokens", color: "#c2410c", label: "Summary-first v1" },
  { key: "legacy_tokens", color: "#7c3aed", label: "Legacy catalog ACP" },
];

export function writeMeasurement(root: string, result: Measurement): void {
  const resultsDir = path.join(root, "results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, "offline.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(path.join(resultsDir, "offline.md"), renderMarkdown(result));
  writeFileSync(
    path.join(resultsDir, "scaling.svg"),
    renderSvg(result.scale, "Context tokens by fork count", NAIVE_SERIES)
  );
  writeFileSync(
    path.join(resultsDir, "scaling-search.svg"),
    renderSvg(result.scale, "Summary-first, v1, legacy ACP, and search", COMPARISON_SERIES)
  );
}

async function main(): Promise<void> {
  const result = await measureCorpus();
  writeMeasurement(EXAMPLE_ROOT, result);
  const scale = result.scale
    .map((row) => `${row.n}:naive ${row.percent_saved.toFixed(1)}% search ${row.percent_saved_vs_search.toFixed(1)}%`)
    .join(" ");
  console.log(`wrote results (${scale})`);
  console.log(
    `enrichment prompt tokens ${result.enrichment.measured_prompt_input_tokens}, vs search break-even ${result.enrichment.measured_token_break_even_vs_search_forks}`
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
