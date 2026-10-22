# ACP inside Daytona sandboxes

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/atomic-content-protocol/sdk/tree/cursor/daytona-acp-benchmark-5c49?devcontainer_path=.devcontainer/devcontainer.json)

Enrich a corpus once, then answer many questions from forked or parallel sandboxes. This example compares four ways to build the prompt:

- **Naive full-read (upper bound).** Each prompt contains every cached page body. A careful agent does not do this, and on the Wikipedia corpus the prompt is larger than a typical 200k-token window.
- **Search-then-read.** Okapi BM25 over the raw title and body (k1=1.2, b=0.75, same stopword list) picks the top 3 pages. The prompt contains a title and URL index, that ranking, and those three full pages.
- **Summary-first ACP (headline).** BM25 over title, summary, and tags only returns the top 3. The prompt contains those compact summaries. The model answers from them or replies `OPEN` with at most 2 page ids. Offline cannot call the model, so a conservative proxy opens the top body unless the top candidate's title, summary, and tags contain every query term and the next score is not close. It opens the top 2 when the scores are close, and never more than 2. The full metadata catalog is not in the prompt. Variant `summary-first-v1` keeps the old term-coverage rule (half of the unique query terms, at least one, up to 3 bodies) for comparison.
- **Legacy ACP (`mcp-find-similar-top3`).** `list_acos` frontmatter for every object, `find_similar` content overlap, then `read_aco` JSON for the top 3. Kept so the catalog cost stays visible.

The committed Wikipedia corpus is 50 English Wikipedia articles (CC BY-SA 4.0; see [ATTRIBUTION.md](ATTRIBUTION.md)) plus 20 questions. A second corpus, Daytona product docs, is measured in [docs-demo](docs-demo). The raw Daytona page text is not in the repo. `src/build-docs.ts` fetches it locally.

## One command

From the repository root, after `npm install` and a build of the workspace packages (`npx turbo run build --filter=@atomic-content-protocol/example-daytona`):

```bash
npm run bench
```

That rewrites the Wikipedia `results/` files. It needs no API keys. If a local Daytona docs cache is present it remeasures that corpus too. If not, it prints the path of the committed docs results. GitHub Codespaces runs the install and build from `.devcontainer/devcontainer.json`, then the same command.

`npm run measure` and `npm run measure:docs` in this package are the same measurements one corpus at a time.

Tokenizer: `cl100k_base` through `computeTokenCounts` (tiktoken 1.0.22). Dollar columns are Haiku 4.5 input at $1 per million tokens. They are not invoices. Output tokens are not included. Summary-first tokens are two cl100k encodings added together: the decision prompt, plus a second prompt (instruction, question, and opened markdown) when a body is opened. v1 tokens are the decision prompt, including its decision line, plus the opened markdown. N=1 is the first question only. Larger N cycles the question bank.

## In the browser

```bash
npm run web
```

That starts a static page on port 5173. It needs no API key, no backend, and it does not call Daytona. Pick a corpus, set N, and press Run.

Wikipedia is measured in the browser with the same `scoreCorpus` function as `npm run bench`, the same MCP `list_acos` / `find_similar` / `read_aco` handlers, and `js-tiktoken` `cl100k_base`. `npm run check:web` checks those counts against `results/offline.json`. The built page is one HTML file (`npm run web:build`, output `web/site/index.html`) so a phone can open it from a single URL. The file is about 7 MB because it includes the Wikipedia extracts and the tokenizer.

Daytona docs stay recorded. The raw page text is not in the page. `https://www.daytona.io` does not send `Access-Control-Allow-Origin`, so the browser cannot fetch the docs and measure them locally.

Preview from this branch: [ACP offline benchmark](https://raw.githack.com/atomic-content-protocol/sdk/cursor/daytona-acp-benchmark-5c49/examples/daytona/web/site/index.html). That host asks you to open the file once, then the page runs. `raw.githubusercontent.com` serves the same file as plain text, so it does not run as a page.

The built HTML stays in the repository. raw.githack.com serves that path from the git tree. GitHub Pages is not enabled, so building the file only inside the workflow would drop this preview URL.

`.github/workflows/benchmark-page.yml` builds `web/site` and deploys it with GitHub Pages on push to this branch. The build on this push succeeded. The deploy returned HTTP 404 because Pages is not enabled. The one step that enables it: repository Settings, Pages, Build and deployment, Source: GitHub Actions, then re-run the Benchmark page workflow. That site would be the benchmark page only. It does not replace atomiccontentprotocol.org.

## Wikipedia, N=100 cycles of 20 questions

| N | Naive tokens | Search tokens | Summary-first tokens | v1 tokens | Legacy tokens | Summary vs search | v1 vs search | Legacy vs search | Search $ | Summary $ | v1 $ | Legacy $ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 562,635 | 31,602 | 335 | 285 | 81,874 | 98.9% | 99.1% | -159.1% | $0.0316 | $0.0003 | $0.0003 | $0.0819 |
| 10 | 5,626,323 | 293,499 | 38,436 | 2,716 | 773,475 | 86.9% | 99.1% | -163.5% | $0.2935 | $0.0384 | $0.0027 | $0.7735 |
| 50 | 28,131,651 | 1,677,005 | 261,116 | 13,926 | 4,057,469 | 84.4% | 99.2% | -141.9% | $1.6770 | $0.2611 | $0.0139 | $4.0575 |
| 100 | 56,263,320 | 3,458,765 | 556,700 | 28,025 | 8,209,985 | 83.9% | 99.2% | -137.4% | $3.4588 | $0.5567 | $0.0280 | $8.2100 |

| N | Search hit | Summary hit | v1 hit | Search answer | Summary answer | v1 answer | Legacy answer |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 10 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 50 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 100 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |

On this Wikipedia set, summary-first uses fewer tokens than search-then-read (556,700 vs 3,458,765 at N=100, 83.9% fewer, and 99.0% fewer than the naive full-read) and matches its 100% retrieval hit and 100% answer support. v1 is cheaper still (28,025, 99.2% fewer than search) because it opens no body. The legacy catalog policy also hits 100% and uses more tokens than search (8,209,985).

The summaries are the Wikipedia leads, and every expected answer string is in one of those leads, so opening a body does not change answer support here. The proxy stays on summaries for 9 of the 20 questions and opens a body for the other 11. v1 stays on summaries for all 20. Summary-first hit means the gold page is among the three summary candidates, not that its body was read. A question whose answer sits only deep in the article can still miss if that page is not rank 1 and the scores are not close enough to open rank 2.

Enrichment, counted once:

| Item | Value |
|---|---|
| Measured `buildUnifiedPrompt` input tokens (cl100k, body truncated to 4000 characters) | 50,696 |
| Estimated output tokens (`estimateEnrichmentCost` standard depth, 300 per page) | 15,000 |
| Package `estimateEnrichmentCost` total | $0.1425 |
| Modeled fast-tier USD (measured input at $1/M plus estimated output at $5/M) | $0.1257 |
| Summary-first break-even vs naive full-read | 1 fork |
| Summary-first break-even vs search-then-read | 2 forks (measured tokens), 4 forks (modeled USD) |
| v1 break-even vs search-then-read | 2 forks (measured tokens) |
| Legacy catalog break-even vs search-then-read | not reached within 100,000 forks |
| Model spend that produced the committed metadata | $0 |

The repository README's illustration of 250,000 tokens down to 35,000 is a different hypothetical. It is not this measurement.

## What the offline numbers count

Policy `summary-first` (`policy.json`):

1. Local BM25 over each ACO's title, summary, and tags. Limit 3. The body and the entity list are not indexed.
2. The decision prompt is the instruction, the question, and three compact summary blocks. It asks for an answer or `OPEN slug` (at most two slugs). It does not contain a pre-written decision line.
3. Live, the model makes that choice. If it answers, no body is opened. If it replies `OPEN` with candidate slugs, a second call receives those markdown bodies (`# title` plus the body), at most `max_bodies` (2).
4. Offline, a conservative proxy stands in for that call. It does not read the expected answer. It opens the top body unless it is strongly confident the hit is enough: every query term is in the top candidate's title, summary, or tags, there are at least two terms, the runner-up covers less than `runner_up_cover_fraction` (0.5) of those terms, and the second score is below `close_score_ratio` (0.85) of the first. When the score ratio is at least 0.85 it opens the top 2. It never opens more than 2.

Variant `summary-first-v1` is the previous rule, frozen: a candidate covers when at least `max(1, ceil(unique query terms * 0.5))` of those terms appear in its title, summary, or tags. If any of the top 3 covers, open nothing. Otherwise open up to 3 bodies. Its token total is still the decision prompt (including the decision line) plus the opened markdown, without a second instruction prefix. `cover_fraction` stays 0.5.

`find_similar` cannot drive this policy. It returns `id`, `title`, and `similarity_score` only. `list_acos` returns every object's full frontmatter. `read_aco` returns pretty JSON. A small SDK addition that would match the demo is `read_summaries({ ids })` returning `{ id, title, summary }[]`, plus a markdown format on `read_aco`. This example does not change the SDK. It reads frontmatter through `list_acos` and ranks it with `sandbox/bm25.mjs`.

Search-then-read still indexes title plus body. The Lucene IDF is `log(1 + (N - df + 0.5) / (df + 0.5))`. Query terms are unique. Ties break by slug. A score of 0 is dropped.

The legacy arm still counts the pretty-printed MCP JSON (`JSON.stringify(result, null, 2)`).

## Daytona docs demo

[docs-demo](docs-demo) asks 15 developer questions against 54 public Daytona product docs (snapshots, volumes, fork, network limits, SDK auth, computer use, and related topics). The page text is fetched by `npm run build-docs` and is gitignored. Committed results:

At N=100, naive full-read is 28,364,485 tokens, search-then-read is 2,321,096 (79% hit, 79% answer support), summary-first is 718,721 (93% hit, 79% answer support, 69.0% fewer tokens than search), v1 is 957,371 (93% hit, 79% answer support, 58.8% fewer), and the legacy catalog policy is 6,498,040 (65% hit, 72% answer support). The legacy total moved from 6,491,862 because `build-docs` now writes stable ACO ids into the catalog JSON. Naive, search, and v1 body counts did not change with that. v1 tokens match the previous summary-first column.

Summary-first beats search-then-read and v1 on tokens, and beats search on retrieval hit. Answer support is tied with both at 79% (12 of 15 distinct questions). It does not beat search on every question. N=1 is `d01` only, where the gold page is not in the top 3. The proxy opens a body on all 15 questions. `d02` now opens the gold page and gains answer support, which v1 missed by staying on the summaries. `d05` still misses: the gold page is rank 2 and the scores are not close, so only rank 1 is opened. `d04` goes the other way: v1 opened three bodies, including the gold page at rank 3, and the new cap of 2 drops that page. Details are in [docs-demo/README.md](docs-demo/README.md).

Summary-first break-even against search-then-read on that corpus is 4 forks of measured tokens (9 forks of modeled enrichment USD). v1 breaks even at 5 forks. The legacy policy still does not break even against search.

## Live Daytona run

`results/live.md` and `results/live.json` are a real N=20 Wikipedia run (region eu, Claude Haiku 4.5, `ACP_LIVE_N=1,10,20`). The file labels the ACP arm `summary-first`. That name, at the time of the run, was the coverage rule now called `summary-first-v1`. It used 6,357 input tokens and 1,266 output tokens. Search-then-read used 783,559 input tokens and 1,788 output tokens. Both arms were correct on 20/20 questions, and both retrieval hit rates were 100%. The new policy has not been run live. One offline cycle of that new policy is 111,340 tokens, because it opens a body on 11 of the 20 questions. v1 for the same cycle is still 5,605.

Offline cl100k for one cycle of the same 20 questions under the rule that was live is 5,605 tokens (v1) and 691,753 (search-then-read). Live provider counts sit about 13% above those figures on both arms, because the provider used Anthropic's tokenizer. The ratio held: that ACP arm stayed about 0.8% of the search-then-read prompt.

Recorded usage at this benchmark's published Haiku 4.5 rates ($1 per million input tokens, $5 per million output tokens) is about $0.81. `live.json` has no cost field. The operator's total spend for the run was about $0.95.

Limits of that run:

- The account has no Linux VM runners in eu or us, so there were no real forks. The recorded fallback is: No runners are configured in region 'eu' for sandbox class 'linux-vm'. The harness used container sandboxes started from a snapshot, with the corpus on the shared volume `acp-daytona-corpus`.
- Sandbox create time was 869 ms minimum, 1.18 s median, 4.67 s maximum.
- About 58 s per sandbox, dominated by reading the corpus from that S3-backed volume.
- Wikipedia only. Naive full-read was not sent. The docs runs below are separate.

`results/live-docs.md` and `results/live-docs.json` are the same kind of run on the docs corpus (N=1, 10, and 20, Claude Haiku 4.5, region eu, container sandboxes from a snapshot, no real forks). The file again labels the arm `summary-first`, and that label means the coverage rule (now v1). At N=20, ACP used 286,314 input tokens and 2,260 output tokens. Search-then-read used 643,400 and 3,005. Retrieval hit was 90% vs 80%. On the first 15 distinct questions that is 14/15 vs 12/15. Model answers were correct 60% of the time vs 75% (10/15 vs 11/15). Answer accuracy for this rule was below search.

The misses are not all the same kind. `d01` is a retrieval miss: the gold page is not a summary candidate, and search hits it. `d02` and `d05` are hits whose bodies were never opened, because the coverage rule said the summaries were enough, and the expected sentence is only in the body. `d13` did open `preview`, `custom-preview-proxy`, and `ssh-access`. The model still answered wrong, and the search arm missed that question too. Offline answer support for `d13` is yes on both v1 and the new proxy, because the expected string is in the opened page. That is a model miss, not a closed-body miss.

`results/live-docs-legacy.md` is the legacy catalog policy at N=10 on the same corpus and setup. ACP used 845,353 input tokens and 1,688 output tokens, with 50% retrieval hit and 50% model answers correct. Search on that run used 314,792 and 1,520, with 70% hit and 70% answers correct.

The volume is mountpoint-s3. Each file write takes about 2 s, existing files cannot be overwritten, and `cp -a` fails while preserving times. Seeding now copies 16 files at a time without preserving attributes, skips files that already exist, writes a `.seeded` marker, and allows 900 s.

Question sandboxes no longer read that volume on the normal path. Wikipedia is already baked into the container image at `/opt/acp`, and those sandboxes read that local disk. A docs run fetches pages with `src/build-docs.ts` when the gitignored cache is missing (the fetch is not committed), uploads them into one sandbox, and captures `sandbox.createSnapshot`. Children read `/opt/acp`. The volume seed, followed by one parallel copy onto local disk per sandbox, runs only if that snapshot fails. `ACP_LIVE_DELETE_VOLUME=1` deletes `acp-daytona-corpus` after the sandboxes are gone.

```bash
export DAYTONA_API_KEY=...
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY
ACP_LIVE_CORPUS=docs ACP_LIVE_N=1,10,20 npm run live -w @atomic-content-protocol/example-daytona
```

`ACP_LIVE_CORPUS` is `wikipedia` (default) or `docs`. `ACP_LIVE_POLICY` is `summary-first` (default), `summary-first-v1`, or `legacy` (the `mcp-find-similar-top3` catalog prompt: `list_acos`, `find_similar`, and `read_aco`). `ACP_LIVE_BASELINE` still defaults to search-then-read. `naive` and `both` are unchanged. `ACP_LIVE_N` defaults to `1,10,50,100`. The harness runs the largest N once and reports smaller rows as prefixes.

Output filenames include the corpus and the policy, so a docs run does not overwrite the Wikipedia report. Wikipedia plus the default policy stays `results/live.md` and `results/live.json`. Docs plus the default policy writes `results/live-docs.md`. Docs plus v1 writes `results/live-docs-v1.md`. Docs plus legacy writes `results/live-docs-legacy.md`.

The command above reruns the docs corpus with the new policy. v1 is `ACP_LIVE_POLICY=summary-first-v1`. Legacy is `ACP_LIVE_POLICY=legacy`.

Summary-first is two model calls when the model replies `OPEN`, and one call when it answers from the summaries. An empty, errored, or uncertain reply falls back to the same bodies the offline proxy would open. v1 is one call, with the coverage decision already written in, and may open 3 bodies. Legacy is one call with the pretty-printed MCP JSON the offline legacy arm counts. The live agent calls `claude-haiku-4-5` when `ANTHROPIC_API_KEY` is set, otherwise `gpt-5.6-luna`. Usage tokens are copied from the provider response and summed across the two summary-first calls. Missing usage stays empty.

SDK calls follow `@daytonaio/sdk` 0.226.0:

- Container snapshot: `daytona.snapshot.create({ name, image: Image.fromDockerfile(...) })`. The image installs `@atomic-content-protocol/cli@0.3.2` and the Wikipedia corpus. At runtime the agent talks to `acp serve` on stdio.
- Linux VM snapshot: `daytona.snapshot.create({ name, image: "node:22-bookworm-slim", sandboxClass: SandboxClass.LINUX_VM })`, then `sandbox.createSnapshot` and `sandbox.fork`. Container sandboxes cannot fork.
- If the VM path fails, question sandboxes are created from the container snapshot and read `/opt/acp`. Docs are uploaded and captured with `sandbox.createSnapshot` first. The volume path is the fallback after that.

## Layout

| Path | Role |
|---|---|
| `Dockerfile` | Container image with the CLI, BM25 helper, and Wikipedia corpus |
| `sandbox/bm25.mjs` | Shared search-then-read and summary-first helper |
| `sandbox/agent.mjs` | Process that runs inside each sandbox |
| `src/measure.ts` | Offline measurement (summary-first, v1, legacy, search, naive) |
| `src/bench.ts` | `npm run bench` entry |
| `src/live.ts` | Daytona harness |
| `docs-demo/` | Docs questions, source list, and committed offline results |
| `results/` | Wikipedia offline report, the recorded Wikipedia live run, and the recorded docs live runs |
| `.devcontainer/devcontainer.json` | Codespaces setup for the offline benchmark |

## Checks

```bash
npm run lint -w @atomic-content-protocol/example-daytona
npm test -w @atomic-content-protocol/example-daytona
```

`npm test` re-runs the Wikipedia measurement and fails if `results/offline.json` has drifted. It spawns `acp serve` and checks that the agent ranks the same summaries and opens the same bodies. If the docs page cache is present it does the same for that corpus. If the cache is absent it checks that the committed docs results are the summary-first run and does not fetch the docs.
