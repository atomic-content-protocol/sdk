/**
 * Offline measurement for the Daytona docs demo. Same three arms as the
 * Wikipedia corpus: naive full-read, BM25 search-then-read, and ACP triage.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureCorpus, renderMarkdown, renderSvg } from "./measure.js";
import { EXAMPLE_ROOT } from "./policy.js";

const DOCS_NOTE =
  "Committed ACO metadata is extractive (the first sentences of each Daytona doc, heading tags, and backtick identifiers). No model was called, so measured model spend for this corpus is $0. The figures below are the size of the real UnifiedPipeline prompt plus the package's estimated output, priced with MODEL_PRICING. They are not an invoice. buildUnifiedPrompt truncates each body to 4000 characters, which is what that prompt builder sends. A job that uploaded every full page would be larger. Break-even against the naive full-read is an upper bound. Break-even against search-then-read is the realistic comparison. Null means ACP did not accumulate a token or dollar saving against that arm within 100,000 forks.";

async function main(): Promise<void> {
  const root = path.join(EXAMPLE_ROOT, "docs-demo");
  const result = await measureCorpus(root, DOCS_NOTE);
  const resultsDir = path.join(root, "results");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, "offline.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(path.join(resultsDir, "offline.md"), renderMarkdown(result));
  writeFileSync(
    path.join(resultsDir, "scaling.svg"),
    renderSvg(result.scale, "Context tokens by fork count", [
      { key: "baseline_tokens", color: "#b45309", label: "Naive full-read (upper bound)" },
      { key: "search_tokens", color: "#1d4ed8", label: "Search-then-read" },
      { key: "acp_tokens", color: "#0f766e", label: "ACP" },
    ])
  );
  writeFileSync(
    path.join(resultsDir, "scaling-search.svg"),
    renderSvg(result.scale, "ACP and search-then-read", [
      { key: "search_tokens", color: "#1d4ed8", label: "Search-then-read" },
      { key: "acp_tokens", color: "#0f766e", label: "ACP" },
    ])
  );
  const scale = result.scale
    .map((row) => `${row.n}:naive ${row.percent_saved.toFixed(1)}% search ${row.percent_saved_vs_search.toFixed(1)}%`)
    .join(" ");
  console.log(`wrote docs results (${scale})`);
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
