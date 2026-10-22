# Daytona docs as ACOs

Fifteen developer questions against 54 public Daytona product docs. The pages were fetched on 2026-10-22 from the markdown URLs listed by [llms.txt](https://www.daytona.io/docs/llms.txt). See [ATTRIBUTION.md](ATTRIBUTION.md) for what was included, what was skipped, and the copyright note.

The raw page text and the full ACO bodies are not in this repository. They are Daytona's copyright. `src/build-docs.ts` regenerates the local cache (needs network). The committed files here are the question bank, the source list, the manifest (titles, URLs, sizes), the vault index, and the offline results. Summaries are produced when that script runs. They are not stored as page text in git. ACO ids are a UUID derived from the slug, and the manifest and index timestamps are a fixed stamp, so a second `build-docs` does not rewrite those tracked files.

Metadata is extractive: the first sentences, heading tags, and backtick identifiers. No model was called.

## One command

From the repository root, after the cache exists:

```bash
npm run build-docs -w @atomic-content-protocol/example-daytona
npm run measure:docs -w @atomic-content-protocol/example-daytona
```

`npm run bench` remeasures this corpus only when the cache is already on disk. Without it, bench still measures the Wikipedia corpus and points at the committed results below.

Same arms as the Wikipedia benchmark, same tokenizer (`cl100k_base`), same BM25 settings (k1=1.2, b=0.75, top 3), same Haiku 4.5 input price of $1 per million tokens. The headline proxy opens at most 2 bodies. v1 keeps the coverage rule (0.5, up to 3 bodies). Output tokens are not included. These are not invoices. N=1 is question `d01` only. Larger N cycles the 15-question bank. The proxy opens a body on all 15 questions. v1 answers 8 of the 15 from summaries and opens no body on those.

| N | Naive tokens | Search tokens | Summary-first tokens | v1 tokens | Legacy tokens | Summary vs search | v1 vs search | Legacy vs search | Search $ | Summary $ | v1 $ | Legacy $ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 283,650 | 54,270 | 16,661 | 27,963 | 71,138 | 69.3% | 48.5% | -31.1% | $0.0543 | $0.0167 | $0.0280 | $0.0711 |
| 10 | 2,836,453 | 249,614 | 92,165 | 123,797 | 701,968 | 63.1% | 50.4% | -181.2% | $0.2496 | $0.0922 | $0.1238 | $0.7020 |
| 50 | 14,182,255 | 1,197,618 | 373,295 | 503,309 | 3,253,902 | 68.8% | 58.0% | -171.7% | $1.1976 | $0.3733 | $0.5033 | $3.2539 |
| 100 | 28,364,485 | 2,321,096 | 718,721 | 957,371 | 6,498,040 | 69.0% | 58.8% | -180.0% | $2.3211 | $0.7187 | $0.9574 | $6.4980 |

| N | Search hit | Summary hit | v1 hit | Search answer | Summary answer | v1 answer | Legacy answer |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100% | 0% | 0% | 100% | 0% | 0% | 0% |
| 10 | 70% | 90% | 90% | 70% | 70% | 70% | 60% |
| 50 | 80% | 92% | 92% | 80% | 76% | 76% | 70% |
| 100 | 79% | 93% | 93% | 79% | 79% | 79% | 72% |

Naive full-read is an upper bound: every page is in the prompt, so the expected string is always in that context (100% answer support). Summary-first hit and v1 hit mean the gold page is one of the three summary candidates. They do not mean the body was opened.

At N=100, summary-first uses 718,721 tokens against search-then-read's 2,321,096 (69.0% fewer) and ranks the gold page 93% of the time against 79%. v1 uses 957,371 (58.8% fewer) with the same 93% hit. Answer support is tied at 79% for search, summary-first, and v1 (12 of 15 distinct questions). The legacy catalog policy uses 6,498,040 tokens and hits 65%. That legacy total is a few thousand tokens above the previous report because the catalog JSON now contains stable ACO ids. A negative "legacy vs search" percent means the catalog policy used more tokens than BM25. That is still true.

N=1 is the counterexample. `d01` (container sandboxes cannot be forked) is opened by search and missed by both ACP arms, because the gold page is not in the top 3. Summary-first is cheaper on that question (16,661 vs 54,270) and does not contain the answer. `d02` (snapshot from a stopped sandbox) is a v1 hit with no answer support, because that rule answered from summaries and the expected sentence is not in them. The new proxy opens `snapshots` and `windows-sandboxes`, and the expected sentence is in the gold page, so answer support is yes. Search misses `d02` as well. `d05` is still a miss for both ACP arms: the gold page `authentication` is rank 2, the scores are not close, and the proxy opens only `file-system-operations`. Search opens the gold page. `d04` is the tradeoff of the 2-body cap: v1 opened `organizations`, `api-keys`, and `network-limits` (the gold page, rank 3) and the answer is in that context. The proxy opens only the first two, so answer support is no.

A recorded live run of the coverage rule (the file labels it `summary-first`; that rule is now v1) answered correctly less often than search: 60% vs 75% at N=20. See the live section of the parent README. The new proxy has not been run live.

Enrichment, counted once, from the local cache:

| Item | Value |
|---|---|
| Measured `buildUnifiedPrompt` input tokens (body truncated to 4000 characters) | 54,630 |
| Estimated output tokens (300 per page, not a completion) | 16,200 |
| Package `estimateEnrichmentCost` total | $0.1516 |
| Modeled fast-tier USD | $0.1356 |
| Summary-first break-even vs naive full-read | 1 fork |
| Summary-first break-even vs search-then-read | 4 forks (measured tokens), 9 forks (modeled USD) |
| v1 break-even vs search-then-read | 5 forks (measured tokens) |
| Legacy catalog break-even vs search-then-read | not reached within 100,000 forks |
| Model spend that produced the metadata | $0 |

Charts: `results/scaling.svg` (naive sets the scale) and `results/scaling-search.svg` (search, summary-first, v1, and the legacy catalog policy).
