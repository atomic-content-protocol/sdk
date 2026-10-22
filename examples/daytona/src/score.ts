/**
 * Shared offline scoring. The Node bench and the browser page both call
 * `scoreCorpus`. Prompt text, retrieval, and token sums live here so the two
 * runs cannot drift apart.
 */

import { bm25Search, searchMaterial, summaryFirst, summaryFirstV1 } from "../sandbox/bm25.mjs";
import { contentQuery, type Policy, promptPrefix, type Question } from "./policy-logic.js";

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolRunner {
  listAcos(args: { limit: number; sortBy: "title"; order: "asc" }): Promise<ToolResult>;
  findSimilar(args: { text: string; limit: number; threshold: number }): Promise<ToolResult>;
  readAco(args: { id: string }): Promise<ToolResult>;
}

export interface CorpusPage {
  slug: string;
  title: string;
  url: string;
  body: string;
}

export type PromptArm = "naive" | "search" | "summary-decision" | "summary-body" | "summary-v1" | "legacy";

export interface QuestionMeasurement {
  id: string;
  question: string;
  gold_slugs: string[];
  content_query: string;
  candidate_slugs: string[];
  opened_slugs: string[];
  decision: "answer" | "open";
  cover_need: number;
  search_opened_slugs: string[];
  legacy_opened_slugs: string[];
  v1_opened_slugs: string[];
  v1_decision: "answer" | "open";
  retrieval_hit: boolean;
  search_retrieval_hit: boolean;
  legacy_retrieval_hit: boolean;
  v1_retrieval_hit: boolean;
  baseline_answer_supported: boolean;
  search_answer_supported: boolean;
  acp_answer_supported: boolean;
  legacy_answer_supported: boolean;
  v1_answer_supported: boolean;
  baseline_tokens: number;
  search_tokens: number;
  summary_decision_tokens: number;
  summary_body_tokens: number;
  acp_tokens: number;
  legacy_tokens: number;
  v1_tokens: number;
  v1_decision_tokens: number;
  v1_body_tokens: number;
  baseline_assembly_ms: number;
  search_assembly_ms: number;
  acp_assembly_ms: number;
  legacy_assembly_ms: number;
}

export interface ScaleRow {
  n: number;
  baseline_tokens: number;
  search_tokens: number;
  acp_tokens: number;
  legacy_tokens: number;
  v1_tokens: number;
  tokens_saved: number;
  percent_saved: number;
  tokens_saved_vs_search: number;
  percent_saved_vs_search: number;
  legacy_tokens_saved_vs_search: number;
  legacy_percent_saved_vs_search: number;
  v1_percent_saved_vs_search: number;
  baseline_input_usd: number;
  search_input_usd: number;
  acp_input_usd: number;
  legacy_input_usd: number;
  v1_input_usd: number;
  usd_saved: number;
  usd_saved_vs_search: number;
  retrieval_hit_rate: number;
  search_retrieval_hit_rate: number;
  legacy_retrieval_hit_rate: number;
  v1_retrieval_hit_rate: number;
  acp_answer_support_rate: number;
  search_answer_support_rate: number;
  legacy_answer_support_rate: number;
  v1_answer_support_rate: number;
  baseline_answer_support_rate: number;
  baseline_assembly_ms: number;
  search_assembly_ms: number;
  acp_assembly_ms: number;
  legacy_assembly_ms: number;
}

export interface ScoredCorpus {
  perQuestion: QuestionMeasurement[];
  prompt(id: string, arm: PromptArm): string;
}

export function usd(tokens: number, perMillion: number): number {
  return (tokens * perMillion) / 1_000_000;
}

export function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

export function sumAssigned(values: number[], n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += values[i % values.length] ?? 0;
  return total;
}

export function rateAssigned(flags: boolean[], n: number): number {
  let hits = 0;
  for (let i = 0; i < n; i++) if (flags[i % flags.length]) hits += 1;
  return hits / n;
}

/** Smallest fork count whose cumulative saving covers `cost`. Null if not within `limit`. */
export function breakEven(savedPerQuestion: number[], cost: number, limit = 100_000): number | null {
  if (cost <= 0) return 0;
  let saved = 0;
  for (let n = 1; n <= limit; n++) {
    saved += savedPerQuestion[(n - 1) % savedPerQuestion.length] ?? 0;
    if (saved >= cost) return n;
  }
  return null;
}

export function scaleRow(perQuestion: QuestionMeasurement[], n: number, inputUsdPerMillion: number): ScaleRow {
  const baselineTokens = sumAssigned(
    perQuestion.map((row) => row.baseline_tokens),
    n
  );
  const searchTokens = sumAssigned(
    perQuestion.map((row) => row.search_tokens),
    n
  );
  const acpTokens = sumAssigned(
    perQuestion.map((row) => row.acp_tokens),
    n
  );
  const legacyTokens = sumAssigned(
    perQuestion.map((row) => row.legacy_tokens),
    n
  );
  const v1Tokens = sumAssigned(
    perQuestion.map((row) => row.v1_tokens),
    n
  );
  const saved = baselineTokens - acpTokens;
  const savedSearch = searchTokens - acpTokens;
  const legacySavedSearch = searchTokens - legacyTokens;
  const v1SavedSearch = searchTokens - v1Tokens;
  return {
    n,
    baseline_tokens: baselineTokens,
    search_tokens: searchTokens,
    acp_tokens: acpTokens,
    legacy_tokens: legacyTokens,
    v1_tokens: v1Tokens,
    tokens_saved: saved,
    percent_saved: baselineTokens === 0 ? 0 : (saved / baselineTokens) * 100,
    tokens_saved_vs_search: savedSearch,
    percent_saved_vs_search: searchTokens === 0 ? 0 : (savedSearch / searchTokens) * 100,
    legacy_tokens_saved_vs_search: legacySavedSearch,
    legacy_percent_saved_vs_search: searchTokens === 0 ? 0 : (legacySavedSearch / searchTokens) * 100,
    v1_percent_saved_vs_search: searchTokens === 0 ? 0 : (v1SavedSearch / searchTokens) * 100,
    baseline_input_usd: roundUsd(usd(baselineTokens, inputUsdPerMillion)),
    search_input_usd: roundUsd(usd(searchTokens, inputUsdPerMillion)),
    acp_input_usd: roundUsd(usd(acpTokens, inputUsdPerMillion)),
    legacy_input_usd: roundUsd(usd(legacyTokens, inputUsdPerMillion)),
    v1_input_usd: roundUsd(usd(v1Tokens, inputUsdPerMillion)),
    usd_saved: roundUsd(usd(saved, inputUsdPerMillion)),
    usd_saved_vs_search: roundUsd(usd(savedSearch, inputUsdPerMillion)),
    retrieval_hit_rate: rateAssigned(
      perQuestion.map((row) => row.retrieval_hit),
      n
    ),
    search_retrieval_hit_rate: rateAssigned(
      perQuestion.map((row) => row.search_retrieval_hit),
      n
    ),
    legacy_retrieval_hit_rate: rateAssigned(
      perQuestion.map((row) => row.legacy_retrieval_hit),
      n
    ),
    v1_retrieval_hit_rate: rateAssigned(
      perQuestion.map((row) => row.v1_retrieval_hit),
      n
    ),
    acp_answer_support_rate: rateAssigned(
      perQuestion.map((row) => row.acp_answer_supported),
      n
    ),
    search_answer_support_rate: rateAssigned(
      perQuestion.map((row) => row.search_answer_supported),
      n
    ),
    legacy_answer_support_rate: rateAssigned(
      perQuestion.map((row) => row.legacy_answer_supported),
      n
    ),
    v1_answer_support_rate: rateAssigned(
      perQuestion.map((row) => row.v1_answer_supported),
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
    search_assembly_ms: Number(
      sumAssigned(
        perQuestion.map((row) => row.search_assembly_ms),
        n
      ).toFixed(2)
    ),
    acp_assembly_ms: Number(
      sumAssigned(
        perQuestion.map((row) => row.acp_assembly_ms),
        n
      ).toFixed(2)
    ),
    legacy_assembly_ms: Number(
      sumAssigned(
        perQuestion.map((row) => row.legacy_assembly_ms),
        n
      ).toFixed(2)
    ),
  };
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Token, retrieval, and answer fields. Assembly time is local and is not compared. */
export function sameMeasurement(left: QuestionMeasurement, right: QuestionMeasurement): boolean {
  return (
    left.id === right.id &&
    left.baseline_tokens === right.baseline_tokens &&
    left.search_tokens === right.search_tokens &&
    left.acp_tokens === right.acp_tokens &&
    left.legacy_tokens === right.legacy_tokens &&
    left.v1_tokens === right.v1_tokens &&
    left.summary_decision_tokens === right.summary_decision_tokens &&
    left.summary_body_tokens === right.summary_body_tokens &&
    left.decision === right.decision &&
    left.v1_decision === right.v1_decision &&
    left.retrieval_hit === right.retrieval_hit &&
    left.search_retrieval_hit === right.search_retrieval_hit &&
    left.legacy_retrieval_hit === right.legacy_retrieval_hit &&
    left.v1_retrieval_hit === right.v1_retrieval_hit &&
    left.acp_answer_supported === right.acp_answer_supported &&
    left.search_answer_supported === right.search_answer_supported &&
    left.baseline_answer_supported === right.baseline_answer_supported &&
    left.legacy_answer_supported === right.legacy_answer_supported &&
    left.v1_answer_supported === right.v1_answer_supported &&
    sameList(left.candidate_slugs, right.candidate_slugs) &&
    sameList(left.opened_slugs, right.opened_slugs) &&
    sameList(left.legacy_opened_slugs, right.legacy_opened_slugs) &&
    sameList(left.v1_opened_slugs, right.v1_opened_slugs) &&
    sameList(left.search_opened_slugs, right.search_opened_slugs)
  );
}

function wire(result: ToolResult): string {
  return JSON.stringify(result, null, 2);
}

function data(result: ToolResult, tool: string): Record<string, unknown> {
  if (!result.success || result.data === null || result.data === undefined || typeof result.data !== "object") {
    throw new Error(`${tool} failed: ${result.error ?? "no data"}`);
  }
  return result.data as Record<string, unknown>;
}

function supports(haystack: string, expected: string): boolean {
  return haystack.toLowerCase().includes(expected.toLowerCase());
}

interface RankedPage extends CorpusPage {
  summary: string;
  tags: string[];
}

interface PromptParts {
  id: string;
  prefix: string;
  searchBody: string;
  summaryMaterial: string;
  summaryBlock: string;
  bodyMaterial: string;
  similarWire: string;
  readWires: string[];
  v1SummaryMaterial: string;
  v1BodyMaterial: string;
}

export async function scoreCorpus(options: {
  policy: Policy;
  questions: Question[];
  pages: CorpusPage[];
  tools: ToolRunner;
  countTokens: (text: string) => Promise<number>;
  onProgress?: (done: number, total: number, id: string) => void | Promise<void>;
}): Promise<ScoredCorpus> {
  const { policy, questions, pages, tools, countTokens, onProgress } = options;
  if (policy.catalog_limit < pages.length) {
    throw new Error(`catalog_limit ${policy.catalog_limit} is below the page count ${pages.length}`);
  }

  const listResult = await tools.listAcos({
    limit: policy.catalog_limit,
    sortBy: "title",
    order: "asc",
  });
  const listData = data(listResult, "list_acos");
  const items = listData["items"];
  if (!Array.isArray(items) || items.length !== pages.length) {
    throw new Error(`list_acos returned ${Array.isArray(items) ? items.length : "no"} items, expected ${pages.length}`);
  }
  const slugById = new Map<string, string>();
  const metaBySlug = new Map<string, { summary: string; tags: string[] }>();
  for (const item of items) {
    const fm = item as Record<string, unknown>;
    const slug = String(fm["corpus_slug"]);
    slugById.set(String(fm["id"]), slug);
    const tags = Array.isArray(fm["tags"]) ? fm["tags"].map((tag) => String(tag)) : [];
    const summary = typeof fm["summary"] === "string" ? fm["summary"] : "";
    metaBySlug.set(slug, { summary, tags });
  }
  const rankedPages: RankedPage[] = pages.map((page) => {
    const meta = metaBySlug.get(page.slug);
    if (!meta) throw new Error(`missing frontmatter for ${page.slug}`);
    return { ...page, summary: meta.summary, tags: meta.tags };
  });
  const catalogWire = wire(listResult);
  const bodies = pages.map((page) => `# ${page.title}\n\n${page.body}`).join("\n\n");
  const baselineMaterial = `${policy.sections.pages}${bodies}`;
  const parts: PromptParts[] = [];
  const perQuestion: QuestionMeasurement[] = [];

  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    if (!question) continue;
    await onProgress?.(index, questions.length, question.id);
    const query = contentQuery(question.question, policy.stopwords);
    if (query.length === 0) throw new Error(`${question.id} has no content words`);

    const prefix = promptPrefix(policy, question.question);
    const baselinePrompt = `${prefix}${baselineMaterial}`;
    const baselineStarted = performance.now();
    const baselineTokens = await countTokens(baselinePrompt);
    const baselineMs = performance.now() - baselineStarted;

    const hits = bm25Search(pages, question.question, policy.stopwords, policy.limit);
    const searchOpened = hits.map((hit) => hit.slug);
    const searchBody = searchMaterial(pages, hits, policy.sections);
    const searchPrompt = `${prefix}${searchBody}`;
    const searchStarted = performance.now();
    const searchTokens = await countTokens(searchPrompt);
    const searchMs = performance.now() - searchStarted;

    const summaryStarted = performance.now();
    const triage = summaryFirst(rankedPages, question.question, policy.stopwords, {
      summaryK: policy.summary_k,
      maxBodies: policy.max_bodies,
      closeScoreRatio: policy.close_score_ratio,
      runnerUpCoverFraction: policy.runner_up_cover_fraction,
    });
    const decisionPrompt = `${prefix}${triage.summaryMaterial}`;
    const followUp =
      triage.bodyMaterial.length === 0 ? "" : `${prefix}${policy.sections.pages}${triage.bodyMaterial}`;
    const decisionTokens = await countTokens(decisionPrompt);
    const bodyTokens = followUp.length === 0 ? 0 : await countTokens(followUp);
    const summaryTokens = decisionTokens + bodyTokens;
    const v1 = summaryFirstV1(rankedPages, question.question, policy.stopwords, {
      summaryK: policy.summary_k,
      maxBodies: policy.v1_max_bodies,
      coverFraction: policy.cover_fraction,
    });
    const v1DecisionPrompt = `${prefix}${v1.summaryMaterial}`;
    const v1DecisionTokens = await countTokens(v1DecisionPrompt);
    const v1BodyTokens = v1.bodyMaterial.length === 0 ? 0 : await countTokens(v1.bodyMaterial);
    const v1Tokens = v1DecisionTokens + v1BodyTokens;
    const summaryMs = performance.now() - summaryStarted;
    const summaryShown = `${triage.summaryBlock}\n${triage.bodyMaterial}`;
    const v1Shown = `${v1.summaryBlock}\n${v1.bodyMaterial}`;

    const similarResult = await tools.findSimilar({
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

    const reads: ToolResult[] = [];
    for (const id of openedIds) {
      reads.push(await tools.readAco({ id }));
    }
    const legacyPrompt = `${prefix}${policy.sections.catalog}${catalogWire}\n\n${policy.sections.ranking}${wire(similarResult)}\n\n${policy.sections.opened}${reads.map(wire).join("\n\n")}`;
    const legacyStarted = performance.now();
    const legacyTokens = await countTokens(legacyPrompt);
    const legacyMs = performance.now() - legacyStarted;

    const openedBodies = reads
      .map((result) => {
        const body = data(result, "read_aco")["body"];
        return typeof body === "string" ? body : "";
      })
      .join("\n");

    parts.push({
      id: question.id,
      prefix,
      searchBody,
      summaryMaterial: triage.summaryMaterial,
      summaryBlock: triage.summaryBlock,
      bodyMaterial: triage.bodyMaterial,
      similarWire: wire(similarResult),
      readWires: reads.map(wire),
      v1SummaryMaterial: v1.summaryMaterial,
      v1BodyMaterial: v1.bodyMaterial,
    });

    perQuestion.push({
      id: question.id,
      question: question.question,
      gold_slugs: question.gold_slugs,
      content_query: query,
      candidate_slugs: triage.candidate_slugs,
      opened_slugs: triage.opened_slugs,
      decision: triage.decision,
      cover_need: triage.cover_need,
      search_opened_slugs: searchOpened,
      legacy_opened_slugs: openedSlugs,
      v1_opened_slugs: v1.opened_slugs,
      v1_decision: v1.decision,
      retrieval_hit: question.gold_slugs.every((slug) => triage.candidate_slugs.includes(slug)),
      search_retrieval_hit: question.gold_slugs.every((slug) => searchOpened.includes(slug)),
      legacy_retrieval_hit: question.gold_slugs.every((slug) => openedSlugs.includes(slug)),
      v1_retrieval_hit: question.gold_slugs.every((slug) => v1.candidate_slugs.includes(slug)),
      baseline_answer_supported: supports(baselineMaterial, question.expected_answer),
      search_answer_supported: supports(searchBody, question.expected_answer),
      acp_answer_supported: supports(summaryShown, question.expected_answer),
      legacy_answer_supported: supports(`${catalogWire}\n${openedBodies}`, question.expected_answer),
      v1_answer_supported: supports(v1Shown, question.expected_answer),
      baseline_tokens: baselineTokens,
      search_tokens: searchTokens,
      summary_decision_tokens: decisionTokens,
      summary_body_tokens: bodyTokens,
      acp_tokens: summaryTokens,
      legacy_tokens: legacyTokens,
      v1_tokens: v1Tokens,
      v1_decision_tokens: v1DecisionTokens,
      v1_body_tokens: v1BodyTokens,
      baseline_assembly_ms: Number(baselineMs.toFixed(2)),
      search_assembly_ms: Number(searchMs.toFixed(2)),
      acp_assembly_ms: Number(summaryMs.toFixed(2)),
      legacy_assembly_ms: Number(legacyMs.toFixed(2)),
    });
  }

  const byId = new Map(parts.map((row) => [row.id, row]));
  return {
    perQuestion,
    prompt(id: string, arm: PromptArm): string {
      const row = byId.get(id);
      if (!row) throw new Error(`unknown question ${id}`);
      if (arm === "naive") return `${row.prefix}${baselineMaterial}`;
      if (arm === "search") return `${row.prefix}${row.searchBody}`;
      if (arm === "summary-decision") return `${row.prefix}${row.summaryMaterial}`;
      if (arm === "summary-body") return row.bodyMaterial.length === 0 ? "" : `${row.prefix}${policy.sections.pages}${row.bodyMaterial}`;
      if (arm === "summary-v1") {
        return row.v1BodyMaterial.length === 0
          ? `${row.prefix}${row.v1SummaryMaterial}`
          : `${row.prefix}${row.v1SummaryMaterial}${row.v1BodyMaterial}`;
      }
      return `${row.prefix}${policy.sections.catalog}${catalogWire}\n\n${policy.sections.ranking}${row.similarWire}\n\n${policy.sections.opened}${row.readWires.join("\n\n")}`;
    },
  };
}
