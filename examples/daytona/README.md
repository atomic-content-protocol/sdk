# ACP inside Daytona sandboxes

Enrich a corpus once, then answer many questions from forked or parallel sandboxes. This example compares three ways to do that:

- **Naive full-read (upper bound).** Each prompt contains every cached page body. A careful agent does not do this, and on the Wikipedia corpus the prompt is larger than a typical 200k-token window. It is kept so the old comparison is still visible.
- **Search-then-read.** Okapi BM25 over the raw title and body (k1=1.2, b=0.75, same stopword list as the ACP query) picks the top 3 pages. The prompt contains a title and URL index, that ranking, and those three full pages.
- **ACP.** Each prompt triages through the local ACP CLI (`acp serve`): `list_acos` frontmatter, `find_similar` content overlap, then `read_aco` for the top 3.

The committed Wikipedia corpus is 50 English Wikipedia articles (CC BY-SA 4.0; see [ATTRIBUTION.md](ATTRIBUTION.md)) plus 20 questions. A second corpus, Daytona's own product docs, is in [docs-demo](docs-demo). Page text and ACOs are in the repo, so the offline measurements do not need network access or API keys.

## One command

From the repository root, after `npm install`:

```bash
npm run measure -w @atomic-content-protocol/example-daytona
```

That rewrites `results/offline.md`, `results/offline.json`, `results/scaling.svg`, and `results/scaling-search.svg`. The table below is the committed run (tiktoken 1.0.22). Re-run the command to reproduce it. N=1 is the first question only. Larger N cycles the 20-question bank.

| N | Naive tokens | Search tokens | ACP tokens | ACP vs naive | ACP vs search | Naive $ | Search $ | ACP $ | Search hit | ACP hit |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 562,635 | 31,602 | 81,874 | 85.4% | -159.1% | $0.5626 | $0.0316 | $0.0819 | 100% | 100% |
| 10 | 5,626,323 | 293,499 | 773,475 | 86.3% | -163.5% | $5.6263 | $0.2935 | $0.7735 | 100% | 100% |
| 50 | 28,131,651 | 1,677,005 | 4,057,469 | 85.6% | -141.9% | $28.1317 | $1.6770 | $4.0575 | 100% | 100% |
| 100 | 56,263,320 | 3,458,765 | 8,209,985 | 85.4% | -137.4% | $56.2633 | $3.4588 | $8.2100 | 100% | 100% |

Dollar columns are Haiku 4.5 input at $1 per million tokens. They are not invoices. Output tokens are not included.

On this 20-question set, both search-then-read and ACP opened every gold page, and every expected answer string was in both contexts. That is a property of these questions, not a general accuracy guarantee. The check is a substring test, not a model grade.

ACP uses fewer tokens than the naive full-read (about 85%). It uses more tokens than search-then-read (the negative "ACP vs search" column). At N=100, search-then-read is 3,458,765 tokens and ACP is 8,209,985. The extra cost is the full metadata catalog and the JSON `read_aco` payloads, on top of opening three pages. Search-then-read already avoids the other 47 bodies.

The repository README's illustration of 250,000 tokens down to 35,000 is a different hypothetical. It is not this measurement.

Enrichment, counted once, for the Wikipedia corpus:

| Item | Value |
|---|---|
| Measured `buildUnifiedPrompt` input tokens (cl100k, body truncated to 4000 characters) | 50,696 |
| Estimated output tokens (`estimateEnrichmentCost` standard depth, 300 per page) | 15,000 |
| Package `estimateEnrichmentCost` total (its own approximate tokenizer) | $0.1425 |
| Modeled fast-tier USD (measured input at $1/M plus estimated output at $5/M) | $0.1257 |
| Break-even vs naive full-read | 1 fork |
| Break-even vs search-then-read | not reached within 100,000 forks |
| Model spend that produced the committed metadata | $0 |

There is no break-even against search-then-read because ACP does not save tokens against that arm, so the enrichment prompt is never paid back by the read path. The committed metadata itself cost $0 in model spend: it was extracted, not generated. The 50,696 figure is what `buildUnifiedPrompt` sends after truncating each body to 4000 characters.

## What the offline numbers count

Tokenizer: `cl100k_base`, through `computeTokenCounts` in `@atomic-content-protocol/core` (the `tiktoken` package). If `cl100k` is missing, the script exits. It does not use a characters/4 estimate.

Policy `mcp-find-similar-top3` (`policy.json`):

1. `list_acos` (limit 50, sorted by title) returns frontmatter for every object. That JSON is in the ACP prompt.
2. `find_similar` ranks with the MCP server's `content_overlap` fallback (Jaccard over title, tags, entity names, and summary). The query drops the stopword list in `policy.json`. Limit 3, threshold 0.
3. `read_aco` returns frontmatter plus body for those three objects only.

Search-then-read uses the same limit and the same stopwords. BM25 is implemented once in `sandbox/bm25.mjs` and shared with the sandbox agent. Indexed text is the title plus the body. The Lucene IDF is `log(1 + (N - df + 0.5) / (df + 0.5))`. Query terms are unique. Ties break by slug. A score of 0 is dropped.

Token counts for ACP use the pretty-printed JSON that `ACPMCPServer` writes on stdio. Naive full-read is the same instruction plus every cached page.

Fork counts above 20 cycle the bank. Assembly time in the JSON is local tokenization time. It is not sandbox boot time and not model latency.

## Daytona docs demo

[docs-demo](docs-demo) converts 54 public Daytona product docs into ACOs and asks 15 developer questions (snapshots, volumes, fork, network limits, SDK auth, computer use, and related topics). Same three arms:

```bash
npm run measure:docs -w @atomic-content-protocol/example-daytona
```

At N=100 on that set, naive full-read is 28,364,485 tokens, search-then-read is 2,321,096 (79% retrieval hit), and ACP is 6,491,862 (65% retrieval hit). ACP is cheaper than the naive upper bound and more expensive, and less accurate, than BM25. Details, the license note, and the full table are in [docs-demo/README.md](docs-demo/README.md).

## Live Daytona run

`results/live.md` is pending. This environment did not have `DAYTONA_API_KEY` or a model key, so no sandbox was started and no live token or timing numbers exist. The harness does not fill those in with estimates.

When the keys are present:

```bash
export DAYTONA_API_KEY=...
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY
npm run live -w @atomic-content-protocol/example-daytona
```

The default live comparison is ACP against search-then-read, so the non-ACP call can fit a normal context window. `ACP_LIVE_BASELINE=naive` sends the full-read upper bound instead. `ACP_LIVE_BASELINE=both` sends both and records a provider error if the naive prompt is rejected. `ACP_LIVE_N=1,10,50,100` is the default row set. The harness runs the largest N once and reports smaller rows as prefixes of that sequence.

SDK calls follow `@daytonaio/sdk` 0.226.0:

- Container snapshot: `daytona.snapshot.create({ name, image: Image.fromDockerfile(...) })`. The image installs `@atomic-content-protocol/cli@0.3.2`. At runtime the agent talks to `acp serve` on stdio.
- Linux VM snapshot: `daytona.snapshot.create({ name, image: "node:22-bookworm-slim", sandboxClass: SandboxClass.LINUX_VM })`, then `sandbox.createSnapshot` and `sandbox.fork`. Container sandboxes cannot fork.
- If the VM path fails, the harness records the error and continues with parallel sandboxes on volume `acp-daytona-corpus` mounted at `/home/daytona/corpus`.

The live agent calls `claude-haiku-4-5` when `ANTHROPIC_API_KEY` is set, otherwise `gpt-5.6-luna`. Usage tokens are copied from the provider response. Missing usage stays empty.

## Layout

| Path | Role |
|---|---|
| `Dockerfile` | Container image with the CLI, BM25 helper, and Wikipedia corpus |
| `sandbox/bm25.mjs` | Shared search-then-read implementation |
| `sandbox/agent.mjs` | Process that runs inside each sandbox |
| `src/measure.ts` | Offline three-way measurement |
| `src/live.ts` | Daytona harness |
| `docs-demo/` | Daytona docs corpus, questions, and offline results |
| `results/` | Wikipedia offline report and the pending live report |

## Checks

```bash
npm run lint -w @atomic-content-protocol/example-daytona
npm test -w @atomic-content-protocol/example-daytona
```

`npm test` re-runs both measurements and fails if a committed `offline.json` has drifted. It also spawns `acp serve` for each corpus and checks that the agent opens the same pages.
