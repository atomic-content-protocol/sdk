/**
 * Offline measurement for the Daytona docs demo. Same four arms as the
 * Wikipedia corpus: naive full-read, BM25 search-then-read, summary-first
 * ACP, and the legacy catalog ACP policy.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureCorpus, writeMeasurement } from "./measure.js";
import { EXAMPLE_ROOT } from "./policy.js";

export const DOCS_NOTE =
  "ACO metadata is extractive (the first sentences of each Daytona doc, heading tags, and backtick identifiers). No model was called, so measured model spend for this corpus is $0. The figures below are the size of the real UnifiedPipeline prompt plus the package's estimated output, priced with MODEL_PRICING. They are not an invoice. buildUnifiedPrompt truncates each body to 4000 characters, which is what that prompt builder sends. A job that uploaded every full page would be larger. Break-even for the headline summary-first policy is against the naive full-read (an upper bound) and against search-then-read. The legacy catalog policy has its own break-even rows. Null means that policy did not accumulate a token saving against that arm within 100,000 forks. Raw Daytona page text is not committed. This measurement reads a local cache produced by src/build-docs.ts.";

export function docsPagesPresent(root = path.join(EXAMPLE_ROOT, "docs-demo")): boolean {
  const pagesDir = path.join(root, "corpus", "pages");
  if (!existsSync(pagesDir)) return false;
  const manifestPath = path.join(root, "corpus", "manifest.json");
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{ slug: string }>;
  return manifest.length > 0 && manifest.every((entry) => existsSync(path.join(pagesDir, `${entry.slug}.txt`)));
}

export async function measureDocs(): Promise<void> {
  const root = path.join(EXAMPLE_ROOT, "docs-demo");
  if (!docsPagesPresent(root)) {
    throw new Error(
      "Daytona docs page text is not in this checkout. Run npm run build-docs (needs network), then rerun this measurement. Committed numbers are in docs-demo/results."
    );
  }
  const result = await measureCorpus(root, DOCS_NOTE);
  writeMeasurement(root, result);
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
  measureDocs().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
