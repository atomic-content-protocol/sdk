# ACP inside Daytona sandboxes

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/atomic-content-protocol/sdk/tree/cursor/daytona-acp-benchmark-5c49?devcontainer_path=.devcontainer/devcontainer.json)

Enrich a corpus once, then answer many questions from forked or parallel sandboxes. This example compares four ways to build the prompt:

- **Naive full-read (upper bound).** Each prompt contains every cached page body. A careful agent does not do this, and on the Wikipedia corpus the prompt is larger than a typical 200k-token window.
- **Search-then-read.** Okapi BM25 over the raw title and body (k1=1.2, b=0.75, same stopword list) picks the top 3 pages. The prompt contains a title and URL index, that ranking, and those three full pages.
- **Summary-first ACP (headline).** BM25 over title, summary, and tags only returns the top 3. The prompt contains those compact summaries. A fixed coverage rule (half of the unique query terms, at least one) either answers from the summaries or opens up to 3 markdown bodies. The full metadata catalog is not in the prompt.
- **Legacy ACP (`mcp-find-similar-top3`).** `list_acos` frontmatter for every object, `find_similar` content overlap, then `read_aco` JSON for the top 3. Kept so the catalog cost stays visible.

The committed Wikipedia corpus is 50 English Wikipedia articles (CC BY-SA 4.0; see [ATTRIBUTION.md](ATTRIBUTION.md)) plus 20 questions. A second corpus, Daytona product docs, is measured in [docs-demo](docs-demo). The raw Daytona page text is not in the repo. `src/build-docs.ts` fetches it locally.

## One command

From the repository root, after `npm install` and a build of the workspace packages (`npx turbo run build --filter=@atomic-content-protocol/example-daytona`):

```bash
npm run bench
```

That rewrites the Wikipedia `results/` files. It needs no API keys. If a local Daytona docs cache is present it remeasures that corpus too. If not, it prints the path of the committed docs results. GitHub Codespaces runs the install and build from `.devcontainer/devcontainer.json`, then the same command.

`npm run measure` and `npm run measure:docs` in this package are the same measurements one corpus at a time.

Tokenizer: `cl100k_base` through `computeTokenCounts` (tiktoken 1.0.22). Dollar columns are Haiku 4.5 input at $1 per million tokens. They are not invoices. Output tokens are not included. Summary-first tokens are two cl100k encodings added together: the decision prompt (including the decision line) plus any opened markdown. N=1 is the first question only. Larger N cycles the question bank.

## Wikipedia, N=100 cycles of 20 questions

| N | Naive tokens | Search tokens | Summary-first tokens | Legacy tokens | Summary vs naive | Summary vs search | Legacy vs search | Naive $ | Search $ | Summary $ | Legacy $ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 562,635 | 31,602 | 285 | 81,874 | 99.9% | 99.1% | -159.1% | $0.5626 | $0.0316 | $0.0003 | $0.0819 |
| 10 | 5,626,323 | 293,499 | 2,716 | 773,475 | 100.0% | 99.1% | -163.5% | $5.6263 | $0.2935 | $0.0027 | $0.7735 |
| 50 | 28,131,651 | 1,677,005 | 13,926 | 4,057,469 | 100.0% | 99.2% | -141.9% | $28.1317 | $1.6770 | $0.0139 | $4.0575 |
| 100 | 56,263,320 | 3,458,765 | 28,025 | 8,209,985 | 100.0% | 99.2% | -137.4% | $56.2633 | $3.4588 | $0.0280 | $8.2100 |

| N | Search hit | Summary hit | Legacy hit | Naive answer | Search answer | Summary answer | Legacy answer |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 10 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 50 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 100 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |

On this Wikipedia set, summary-first uses fewer tokens than search-then-read (28,025 vs 3,458,765 at N=100) and matches its 100% retrieval hit and 100% answer support. The legacy catalog policy also hits 100% and uses more tokens than search (8,209,985).

That token gap is narrow in what it proves. All 20 questions were answered from summaries. No body was opened. The summaries are the Wikipedia leads, and every expected answer string is in one of those leads. A question whose answer sits only deep in the article would either open up to three bodies or fail answer support. Summary-first hit means the gold page is among the three summary candidates, not that its body was read.

Enrichment, counted once:

| Item | Value |
|---|---|
| Measured `buildUnifiedPrompt` input tokens (cl100k, body truncated to 4000 characters) | 50,696 |
| Estimated output tokens (`estimateEnrichmentCost` standard depth, 300 per page) | 15,000 |
| Package `estimateEnrichmentCost` total | $0.1425 |
| Modeled fast-tier USD (measured input at $1/M plus estimated output at $5/M) | $0.1257 |
| Summary-first break-even vs naive full-read | 1 fork |
| Summary-first break-even vs search-then-read | 2 forks (measured tokens), 4 forks (modeled USD) |
| Legacy catalog break-even vs search-then-read | not reached within 100,000 forks |
| Model spend that produced the committed metadata | $0 |

The repository README's illustration of 250,000 tokens down to 35,000 is a different hypothetical. It is not this measurement.

## What the offline numbers count

Policy `summary-first` (`policy.json`):

1. Local BM25 over each ACO's title, summary, and tags. Limit 3. The body and the entity list are not indexed.
2. The decision prompt is the instruction, the question, three compact summary blocks, and one decision line: `Decision: answer from summaries.` or `Decision: open slug, slug, slug.`
3. A candidate covers the question when the count of unique query terms found in its title, summary, and tags is at least `max(1, ceil(terms * 0.5))`. If any of the three covers, open nothing. Otherwise open all three as markdown (`# title` plus the body), not as JSON.

`find_similar` cannot drive this policy. It returns `id`, `title`, and `similarity_score` only. `list_acos` returns every object's full frontmatter. `read_aco` returns pretty JSON. A small SDK addition that would match the demo is `read_summaries({ ids })` returning `{ id, title, summary }[]`, plus a markdown format on `read_aco`. This example does not change the SDK. It reads frontmatter through `list_acos` and ranks it with `sandbox/bm25.mjs`.

Search-then-read still indexes title plus body. The Lucene IDF is `log(1 + (N - df + 0.5) / (df + 0.5))`. Query terms are unique. Ties break by slug. A score of 0 is dropped.

The legacy arm still counts the pretty-printed MCP JSON (`JSON.stringify(result, null, 2)`).

## Daytona docs demo

[docs-demo](docs-demo) asks 15 developer questions against 54 public Daytona product docs (snapshots, volumes, fork, network limits, SDK auth, computer use, and related topics). The page text is fetched by `npm run build-docs` and is gitignored. Committed results:

At N=100, naive full-read is 28,364,485 tokens, search-then-read is 2,321,096 (79% hit, 79% answer support), summary-first is 957,371 (93% hit, 79% answer support), and the legacy catalog policy is 6,491,862 (65% hit, 72% answer support).

Summary-first beats search-then-read on tokens and on retrieval hit. Answer support is tied at 79%. It does not beat search on every question: N=1 is `d01` only, where search hits and summary-first does not. Eight of the 15 questions were answered from summaries with no body opened, so a hit can be true while the expected string is absent (`d02`, `d05`). Details are in [docs-demo/README.md](docs-demo/README.md).

Summary-first break-even against search-then-read on that corpus is 5 forks of measured tokens (12 forks of modeled enrichment USD). The legacy policy still does not break even against search.

## Live Daytona run

`results/live.md` is pending. This environment did not have `DAYTONA_API_KEY` or a model key, so no sandbox was started and no live token or timing numbers exist. The harness does not fill those in with estimates.

When the keys are present:

```bash
export DAYTONA_API_KEY=...
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY
npm run live -w @atomic-content-protocol/example-daytona
```

The ACP arm is summary-first, using the same coverage rule as the offline measurement, sent as one model call. The default comparison arm is search-then-read. `ACP_LIVE_BASELINE=naive` sends the full-read upper bound. `ACP_LIVE_BASELINE=both` sends both. `ACP_LIVE_N=1,10,50,100` is the default row set. The harness runs the largest N once and reports smaller rows as prefixes.

SDK calls follow `@daytonaio/sdk` 0.226.0:

- Container snapshot: `daytona.snapshot.create({ name, image: Image.fromDockerfile(...) })`. The image installs `@atomic-content-protocol/cli@0.3.2`. At runtime the agent talks to `acp serve` on stdio.
- Linux VM snapshot: `daytona.snapshot.create({ name, image: "node:22-bookworm-slim", sandboxClass: SandboxClass.LINUX_VM })`, then `sandbox.createSnapshot` and `sandbox.fork`. Container sandboxes cannot fork.
- If the VM path fails, the harness records the error and continues with parallel sandboxes on volume `acp-daytona-corpus` mounted at `/home/daytona/corpus`.

The live agent calls `claude-haiku-4-5` when `ANTHROPIC_API_KEY` is set, otherwise `gpt-5.6-luna`. Usage tokens are copied from the provider response. Missing usage stays empty. Provider usage on the concatenated prompt can differ slightly from the offline sum of two encodings.

## Layout

| Path | Role |
|---|---|
| `Dockerfile` | Container image with the CLI, BM25 helper, and Wikipedia corpus |
| `sandbox/bm25.mjs` | Shared search-then-read and summary-first helper |
| `sandbox/agent.mjs` | Process that runs inside each sandbox |
| `src/measure.ts` | Offline four-arm measurement |
| `src/bench.ts` | `npm run bench` entry |
| `src/live.ts` | Daytona harness |
| `docs-demo/` | Docs questions, source list, and committed offline results |
| `results/` | Wikipedia offline report and the pending live report |
| `.devcontainer/devcontainer.json` | Codespaces setup for the offline benchmark |

## Checks

```bash
npm run lint -w @atomic-content-protocol/example-daytona
npm test -w @atomic-content-protocol/example-daytona
```

`npm test` re-runs the Wikipedia measurement and fails if `results/offline.json` has drifted. It spawns `acp serve` and checks that the agent ranks the same summaries and opens the same bodies. If the docs page cache is present it does the same for that corpus. If the cache is absent it checks that the committed docs results are the summary-first run and does not fetch the docs.
