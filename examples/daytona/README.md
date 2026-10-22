# ACP inside Daytona sandboxes

Enrich a corpus once, then answer many questions from forked or parallel sandboxes. This example compares two ways to do that:

- **Baseline.** Each sandbox is given every cached page body.
- **ACP.** Each sandbox triages Atomic Content Object metadata through the local ACP CLI (`acp serve`), then opens full content only for the top hits.

The committed corpus is 50 English Wikipedia articles (CC BY-SA 4.0; see [ATTRIBUTION.md](ATTRIBUTION.md)) plus 20 questions with expected answer strings. Page text and ACOs are in the repo, so the offline measurement does not need network access or API keys.

## One command

From the repository root, after `npm install`:

```bash
npm run measure -w @atomic-content-protocol/example-daytona
```

That rewrites `results/offline.md`, `results/offline.json`, and `results/scaling.svg`. The table below is the committed run (tiktoken 1.0.22). Re-run the command to reproduce it.

| N | Baseline tokens | ACP tokens | Saved | Saved % | Baseline input $ | ACP input $ | $ saved | Retrieval hit | ACP answer support | Baseline answer support |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 562,635 | 81,874 | 480,761 | 85.4% | $0.5626 | $0.0819 | $0.4808 | 100.0% | 100.0% | 100.0% |
| 10 | 5,626,323 | 773,475 | 4,852,848 | 86.3% | $5.6263 | $0.7735 | $4.8528 | 100.0% | 100.0% | 100.0% |
| 50 | 28,131,651 | 4,057,469 | 24,074,182 | 85.6% | $28.1317 | $4.0575 | $24.0742 | 100.0% | 100.0% | 100.0% |
| 100 | 56,263,320 | 8,209,985 | 48,053,335 | 85.4% | $56.2633 | $8.2100 | $48.0533 | 100.0% | 100.0% | 100.0% |

On this 20-question set, every gold page was in the top 3 and every expected answer string was present in both contexts. That is a property of these questions and this scorer, not a general accuracy guarantee. The check is a substring test, not a model grade.

The saved share is about 85% to 86%. That is not the repository README's illustration of 250,000 tokens down to 35,000. At N=1 this corpus is 562,635 baseline tokens against 81,874 ACP tokens. The baseline is larger because these are full Wikipedia extracts, and the ACP prompt still includes the metadata catalog plus three full pages.

Enrichment, counted once:

| Item | Value |
|---|---|
| Measured `buildUnifiedPrompt` input tokens (cl100k, body truncated to 4000 characters) | 50,696 |
| Estimated output tokens (`estimateEnrichmentCost` standard depth, 300 per page) | 15,000 |
| Package `estimateEnrichmentCost` total (its own approximate tokenizer) | $0.1425 |
| Modeled fast-tier USD (measured input at $1/M plus estimated output at $5/M) | $0.1257 |
| Break-even, measured tokens | 1 fork |
| Break-even, modeled USD | 1 fork |
| Model spend that produced the committed metadata | $0 |

Break-even is 1 fork because one question already saves 480,761 input tokens and the measured enrichment prompt is 50,696 tokens. The prompt is small because `buildUnifiedPrompt` truncates each body to 4000 characters. The committed metadata itself cost $0 in model spend: it was extracted, not generated.

## What the offline numbers count

Tokenizer: `cl100k_base`, through `computeTokenCounts` in `@atomic-content-protocol/core` (the `tiktoken` package). If `cl100k` is missing, the script exits. It does not use a characters/4 estimate.

Policy `mcp-find-similar-top3` (`policy.json`):

1. `list_acos` (limit 50, sorted by title) returns frontmatter for every object. That JSON is in the prompt. It includes title, summary, tags, entities, and token counts, plus the other frontmatter fields the tool returns.
2. `find_similar` ranks with the MCP server's `content_overlap` fallback (Jaccard over title, tags, entity names, and summary). The query is the question with the stopword list in `policy.json` removed. Limit 3, threshold 0.
3. `read_aco` returns frontmatter plus body for those three objects only.

Token counts use the pretty-printed JSON that `ACPMCPServer` writes on stdio (`JSON.stringify(result, null, 2)`). The baseline prompt is the same instruction plus every cached page.

Dollar columns apply `MODEL_PRICING["claude-haiku-4-5"]` input price ($1 per million tokens) to those input tokens. Output is not included, because this run does not call a model. These are not invoices.

Fork counts above 20 cycle the 20-question bank. N=100 is five passes over the same questions, not 100 distinct questions. Assembly time in the JSON is local tokenization time, summed across assignments. It is not sandbox boot time and not model latency.

The repository README's 86% illustration (about 250,000 tokens down to about 35,000 on 50 documents) is a different hypothetical. It is not this measurement. An earlier live benchmark in `examples/benchmark-results.md` (20 synthetic documents, 2026-04-15) is also a different setup.

Retrieval hit means every gold page for that question was opened. Answer support means the expected answer string occurs in the context. That is a string check, not a model grade.

## Enrichment, counted once

The committed ACO metadata is extractive: Wikipedia lead sentences, MediaWiki categories, and a proper-noun scan (`src/build-corpus.ts`). No model was called, so the model spend that produced this corpus is $0.

The report also counts what a real `UnifiedPipeline` pass would send: `buildUnifiedPrompt` measured with cl100k, plus the output-token constant from `estimateEnrichmentCost` at standard depth. Those figures are labeled as measured prompt size and estimated output. They are not an invoice.

Break-even is the smallest fork count whose cumulative input-token savings cover the measured enrichment prompt. A second break-even compares modeled dollars (measured prompt input plus estimated output, at the same Haiku prices) with the input-only savings on the read path.

## Live Daytona run

`results/live.md` is pending. This environment did not have `DAYTONA_API_KEY` or a model key, so no sandbox was started and no live token or timing numbers exist. The harness does not fill those in with estimates.

When the keys are present:

```bash
export DAYTONA_API_KEY=...
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY
npm run live -w @atomic-content-protocol/example-daytona
```

Optional: `ACP_LIVE_N=1,10,50,100` (the default). The harness runs the largest N once and reports smaller rows as prefixes of that sequence.

SDK calls follow `@daytonaio/sdk` 0.226.0 and the Daytona docs:

- Container snapshot: `daytona.snapshot.create({ name, image: Image.fromDockerfile(...) })` from the `Dockerfile`. The image installs `@atomic-content-protocol/cli@0.3.2` at build time. At runtime the agent talks to `acp serve` on stdio and does not call a hosted ACP service. Lower Daytona tiers restrict network egress; the vault is already in the image.
- Linux VM snapshot: `daytona.snapshot.create({ name, image: "node:22-bookworm-slim", sandboxClass: SandboxClass.LINUX_VM })`. Dockerfiles are not accepted for VM snapshots. The parent sandbox installs the CLI, receives the corpus, then `sandbox.createSnapshot`.
- Fork: `sandbox.fork({ name })`. Daytona documents that forking is not supported for container sandboxes. The harness tries the VM path first.
- If VM setup or fork fails, it records the error and continues with parallel sandboxes created from the container snapshot, all mounting volume `acp-daytona-corpus` at `/home/daytona/corpus` (`daytona.volume.get(name, true)`, then `volumes: [{ volumeId, mountPath }]`). The volume is left in place. Snapshots created by the run are deleted afterward.

The live agent calls `claude-haiku-4-5` when `ANTHROPIC_API_KEY` is set, otherwise `gpt-5.6-luna` with `OPENAI_API_KEY`. Usage tokens are copied from the provider response. If a call is rejected (the baseline prompt is larger than a typical 200k-token window), the error string is stored and the usage stays empty.

## Layout

| Path | Role |
|---|---|
| `Dockerfile` | Container image with the CLI and corpus |
| `src/image.ts` | Snapshot helpers used by the live harness |
| `src/build-corpus.ts` | Refresh the corpus from Wikipedia (needs network; mints new ACO ids) |
| `src/measure.ts` | Offline token measurement |
| `src/live.ts` | Daytona harness |
| `src/verify.ts` | Checks the corpus, the committed table, and a local `acp serve` smoke |
| `sandbox/agent.mjs` | Process that runs inside each sandbox |
| `corpus/` | URLs, cached pages, questions, vault |
| `results/` | Committed offline report and the pending live report |

## Checks

```bash
npm run lint -w @atomic-content-protocol/example-daytona
npm test -w @atomic-content-protocol/example-daytona
```

`npm test` re-runs the measurement and fails if `results/offline.json` has drifted. It also spawns `acp serve` and checks that the sandbox agent opens the same pages.
