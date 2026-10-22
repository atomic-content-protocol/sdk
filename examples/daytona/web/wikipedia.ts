/**
 * Wikipedia run. Same scorer, MCP tool handlers, and cl100k counter as
 * `src/check-web.ts`. Page text is imported from the committed corpus.
 */

import "./buffer-shim.js";
import { parseACO } from "../../../packages/core/src/io/parse.js";
import { pricingFor } from "../../../packages/enrichment/src/providers/models.js";
import { estimateEnrichmentCost } from "../../../packages/enrichment/src/utils/cost.js";
import { buildUnifiedPrompt } from "../../../packages/enrichment/src/utils/prompts.js";
import manifestJson from "../corpus/manifest.json";
import questionsJson from "../corpus/questions.json";
import policyJson from "../policy.json";
import wikiBench from "../results/offline.json";
import { toolsFromStorage } from "../src/aco-tools.js";
import { countCl100kJs } from "../src/cl100k-js.js";
import { memoryVault } from "../src/memory-vault.js";
import type { Policy, Question } from "../src/policy-logic.js";
import {
  breakEven,
  type QuestionMeasurement,
  roundUsd,
  type ScoredCorpus,
  sameMeasurement,
  scoreCorpus,
  usd,
} from "../src/score.js";
import type { BenchView } from "./render.js";

interface ManifestEntry {
  slug: string;
  title: string;
  source_url: string;
}

const pageFiles = import.meta.glob("../corpus/pages/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const vaultFiles = import.meta.glob("../corpus/vault/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function fileName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function yieldFrame(message: string, onProgress: (message: string) => void): Promise<void> {
  onProgress(message);
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function runWikipedia(onProgress: (message: string) => void): Promise<BenchView> {
  const policy = policyJson as Policy;
  const questions = questionsJson as Question[];
  const manifest = manifestJson as ManifestEntry[];
  const pricing = pricingFor("claude-haiku-4-5");
  if (!pricing) throw new Error("missing Haiku 4.5 price");

  const pages = manifest.map((entry) => {
    const key = Object.keys(pageFiles).find((path) => fileName(path) === `${entry.slug}.txt`);
    if (!key) throw new Error(`missing page text for ${entry.slug}`);
    const raw = pageFiles[key];
    if (raw === undefined) throw new Error(`missing page text for ${entry.slug}`);
    return {
      slug: entry.slug,
      title: entry.title,
      url: entry.source_url,
      body: raw.replace(/\n$/, ""),
    };
  });

  const acos = Object.values(vaultFiles).map((raw) => {
    const parsed = parseACO(raw);
    return { frontmatter: parsed.frontmatter, body: parsed.body };
  });
  if (acos.length !== pages.length) {
    throw new Error(`parsed ${acos.length} ACOs, expected ${pages.length}`);
  }

  await yieldFrame(`Measuring ${questions[0]?.id ?? "question"} (1 of ${questions.length}).`, onProgress);
  const scored = await scoreCorpus({
    policy,
    questions,
    pages,
    tools: toolsFromStorage(memoryVault(acos)),
    countTokens: async (text) => countCl100kJs(text),
    onProgress: (done, total, id) => yieldFrame(`Measuring ${id} (${done + 1} of ${total}).`, onProgress),
  });

  await yieldFrame("Counting the enrichment prompts.", onProgress);
  let measuredInput = 0;
  let estimatedOutput = 0;
  let packageUsd = 0;
  for (const page of pages) {
    measuredInput += countCl100kJs(buildUnifiedPrompt(page.title, page.body));
    const estimate = estimateEnrichmentCost(page.body, "standard", { model: "claude-haiku-4-5" });
    estimatedOutput += estimate.outputTokens;
    packageUsd += estimate.cost;
  }
  const modeledUsd = roundUsd(usd(measuredInput, pricing.input) + usd(estimatedOutput, pricing.output));

  const committed = wikiBench.per_question as QuestionMeasurement[];
  const mismatch = firstMismatch(scored.perQuestion, committed);
  const enrichmentMatches =
    measuredInput === wikiBench.enrichment.measured_prompt_input_tokens &&
    estimatedOutput === wikiBench.enrichment.estimated_output_tokens;
  const n100 = scored.perQuestion.length;
  const summaryAt100 = sumCycled(
    scored.perQuestion.map((row) => row.acp_tokens),
    100
  );
  const matchNote = mismatch
    ? `Browser counts differ from results/offline.json at ${mismatch}.`
    : `Browser token counts match the committed Node bench in results/offline.json. N=100 summary-first is ${summaryAt100.toLocaleString("en-US")} tokens ($${usd(summaryAt100, pricing.input).toFixed(4)}). Enrichment prompt tokens are ${measuredInput.toLocaleString("en-US")}${enrichmentMatches ? ", the same count as the Node run" : ""}. Break-even vs search is ${String(
        breakEven(
          scored.perQuestion.map((row) => row.search_tokens - row.acp_tokens),
          measuredInput
        )
      )} forks.`;

  return {
    sourceLabel: `Measured in this browser. ${pages.length} Wikipedia pages, ${n100} questions. js-tiktoken cl100k_base.`,
    perQuestion: scored.perQuestion,
    prompt: scored.prompt.bind(scored) as ScoredCorpus["prompt"],
    enrichment: {
      measuredInput,
      estimatedOutput,
      packageUsd: roundUsd(packageUsd),
      modeledUsd,
    },
    matchNote,
    recorded: false,
  };
}

function sumCycled(values: number[], n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += values[i % values.length] ?? 0;
  return total;
}

function firstMismatch(fresh: QuestionMeasurement[], committed: QuestionMeasurement[]): string | null {
  if (fresh.length !== committed.length) return `question count ${fresh.length} vs ${committed.length}`;
  for (let i = 0; i < fresh.length; i++) {
    const next = fresh[i];
    const prev = committed[i];
    if (!next || !prev) return "missing row";
    if (!sameMeasurement(next, prev)) {
      return `${next.id} (naive ${next.baseline_tokens} vs ${prev.baseline_tokens}, summary ${next.acp_tokens} vs ${prev.acp_tokens}, legacy ${next.legacy_tokens} vs ${prev.legacy_tokens})`;
    }
  }
  return null;
}
