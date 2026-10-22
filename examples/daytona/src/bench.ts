/**
 * One-command offline benchmark. No API keys.
 *
 * Always remeasures the committed Wikipedia corpus. Remeasures the Daytona
 * docs corpus only when `npm run build-docs` has left a local page cache.
 * That cache is gitignored because the page text is Daytona's copyright.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureCorpus, writeMeasurement } from "./measure.js";
import { docsPagesPresent, measureDocs } from "./measure-docs.js";
import { EXAMPLE_ROOT } from "./policy.js";

async function main(): Promise<void> {
  const wiki = await measureCorpus();
  writeMeasurement(EXAMPLE_ROOT, wiki);
  const wikiScale = wiki.scale
    .map((row) => `N=${row.n} summary-first ${row.acp_tokens} search ${row.search_tokens}`)
    .join("; ");
  console.log(`wikipedia ${wikiScale}`);
  if (docsPagesPresent()) {
    await measureDocs();
    return;
  }
  const results = path.join(EXAMPLE_ROOT, "docs-demo", "results", "offline.md");
  console.log(
    `Daytona docs page text is not in this checkout (it is gitignored). Committed results: ${results}. Regenerate the cache with npm run build-docs -w @atomic-content-protocol/example-daytona (needs network), then rerun bench.`
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
