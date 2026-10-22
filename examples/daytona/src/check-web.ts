/**
 * Proves the browser path matches the committed Node bench.
 * Memory vault + the MCP tool handlers + js-tiktoken, against results/offline.json
 * (FilesystemAdapter + ACPMCPServer + tiktoken).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseACO } from "@atomic-content-protocol/core";
import { buildUnifiedPrompt, estimateEnrichmentCost, pricingFor } from "@atomic-content-protocol/enrichment";
import { toolsFromStorage } from "./aco-tools.js";
import { countCl100kJs } from "./cl100k-js.js";
import { memoryVault } from "./memory-vault.js";
import { EXAMPLE_ROOT, loadPolicy, type Question } from "./policy.js";
import { breakEven, type QuestionMeasurement, sameMeasurement, scaleRow, scoreCorpus, usd } from "./score.js";

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  const root = EXAMPLE_ROOT;
  const policy = loadPolicy(root);
  const pricing = pricingFor("claude-haiku-4-5");
  if (!pricing) fail("missing price");
  const questions = JSON.parse(readFileSync(path.join(root, "corpus", "questions.json"), "utf8")) as Question[];
  const manifest = JSON.parse(readFileSync(path.join(root, "corpus", "manifest.json"), "utf8")) as Array<{
    slug: string;
    title: string;
    source_url: string;
  }>;
  const pages = manifest.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    url: entry.source_url,
    body: readFileSync(path.join(root, "corpus", "pages", `${entry.slug}.txt`), "utf8").replace(/\n$/, ""),
  }));
  const vault = path.join(root, "corpus", "vault");
  const acos = readdirSync(vault)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const parsed = parseACO(readFileSync(path.join(vault, name), "utf8"));
      return { frontmatter: parsed.frontmatter, body: parsed.body };
    });
  if (acos.length !== pages.length) fail(`parsed ${acos.length} ACOs, expected ${pages.length}`);

  const scored = await scoreCorpus({
    policy,
    questions,
    pages,
    tools: toolsFromStorage(memoryVault(acos)),
    countTokens: async (text) => countCl100kJs(text),
  });

  const committed = JSON.parse(readFileSync(path.join(root, "results", "offline.json"), "utf8")) as {
    per_question: QuestionMeasurement[];
    scale: Array<{
      n: number;
      baseline_tokens: number;
      search_tokens: number;
      acp_tokens: number;
      legacy_tokens: number;
    }>;
    enrichment: {
      measured_prompt_input_tokens: number;
      estimated_output_tokens: number;
      package_estimate_usd: number;
    };
  };

  if (scored.perQuestion.length !== committed.per_question.length) fail("question count");
  for (let i = 0; i < scored.perQuestion.length; i++) {
    const next = scored.perQuestion[i];
    const prev = committed.per_question[i];
    if (!next || !prev) fail("missing row");
    if (!sameMeasurement(next, prev)) {
      fail(
        `${next.id} browser path diverged: naive ${next.baseline_tokens}/${prev.baseline_tokens} search ${next.search_tokens}/${prev.search_tokens} summary ${next.acp_tokens}/${prev.acp_tokens} legacy ${next.legacy_tokens}/${prev.legacy_tokens} decision ${next.decision}/${prev.decision}`
      );
    }
  }

  for (const row of committed.scale) {
    const fresh = scaleRow(scored.perQuestion, row.n, pricing.input);
    if (
      fresh.baseline_tokens !== row.baseline_tokens ||
      fresh.search_tokens !== row.search_tokens ||
      fresh.acp_tokens !== row.acp_tokens ||
      fresh.legacy_tokens !== row.legacy_tokens
    ) {
      fail(`scale N=${row.n} diverged`);
    }
  }

  let measuredInput = 0;
  let estimatedOutput = 0;
  let packageUsd = 0;
  for (const page of pages) {
    measuredInput += countCl100kJs(buildUnifiedPrompt(page.title, page.body));
    const estimate = estimateEnrichmentCost(page.body, "standard", { model: "claude-haiku-4-5" });
    estimatedOutput += estimate.outputTokens;
    packageUsd += estimate.cost;
  }
  if (measuredInput !== committed.enrichment.measured_prompt_input_tokens) {
    fail(`enrichment prompt tokens ${measuredInput}, committed ${committed.enrichment.measured_prompt_input_tokens}`);
  }
  if (estimatedOutput !== committed.enrichment.estimated_output_tokens) {
    fail(`enrichment output tokens ${estimatedOutput}, committed ${committed.enrichment.estimated_output_tokens}`);
  }
  if (packageUsd.toFixed(4) !== committed.enrichment.package_estimate_usd.toFixed(4)) {
    fail(`package enrichment USD ${packageUsd} vs ${committed.enrichment.package_estimate_usd}`);
  }

  const saved = scored.perQuestion.map((row) => row.search_tokens - row.acp_tokens);
  const even = breakEven(saved, committed.enrichment.measured_prompt_input_tokens);
  if (even !== 2) fail(`wikipedia break-even vs search was ${String(even)}, expected 2`);
  const n100 = scaleRow(scored.perQuestion, 100, pricing.input);
  if (usd(n100.acp_tokens, pricing.input).toFixed(4) !== "0.0280") {
    fail(`N=100 summary dollars ${usd(n100.acp_tokens, pricing.input)}`);
  }
  console.log(
    `browser path matches Node bench (N=100 summary-first ${n100.acp_tokens} tokens, js-tiktoken cl100k_base)`
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
