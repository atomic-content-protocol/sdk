# Daytona docs as ACOs

Fifteen developer questions against 54 public Daytona product docs. The pages were fetched on 2026-10-22 from the markdown URLs listed by [llms.txt](https://www.daytona.io/docs/llms.txt). See [ATTRIBUTION.md](ATTRIBUTION.md) for what was included, what was skipped, and the copyright note.

The raw page text and the full ACO bodies are not in this repository. They are Daytona's copyright. `src/build-docs.ts` regenerates the local cache (needs network). The committed files here are the question bank, the source list, the manifest (titles, URLs, sizes), the vault index, and the offline results. Summaries are produced when that script runs. They are not stored as page text in git.

Metadata is extractive: the first sentences, heading tags, and backtick identifiers. No model was called.

## One command

From the repository root, after the cache exists:

```bash
npm run build-docs -w @atomic-content-protocol/example-daytona
npm run measure:docs -w @atomic-content-protocol/example-daytona
```

`npm run bench` remeasures this corpus only when the cache is already on disk. Without it, bench still measures the Wikipedia corpus and points at the committed results below.

Same four arms as the Wikipedia benchmark, same tokenizer (`cl100k_base`), same BM25 settings (k1=1.2, b=0.75, top 3), same coverage rule (0.5), same Haiku 4.5 input price of $1 per million tokens. Output tokens are not included. These are not invoices. N=1 is question `d01` only. Larger N cycles the 15-question bank. Eight of the 15 questions were answered from summaries and opened no body.

| N | Naive tokens | Search tokens | Summary-first tokens | Legacy tokens | Summary vs naive | Summary vs search | Legacy vs search | Naive $ | Search $ | Summary $ | Legacy $ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 283,650 | 54,270 | 27,963 | 71,081 | 90.1% | 48.5% | -31.0% | $0.2837 | $0.0543 | $0.0280 | $0.0711 |
| 10 | 2,836,453 | 249,614 | 123,797 | 701,352 | 95.6% | 50.4% | -181.0% | $2.8365 | $0.2496 | $0.1238 | $0.7014 |
| 50 | 14,182,255 | 1,197,618 | 503,309 | 3,250,792 | 96.5% | 58.0% | -171.4% | $14.1823 | $1.1976 | $0.5033 | $3.2508 |
| 100 | 28,364,485 | 2,321,096 | 957,371 | 6,491,862 | 96.6% | 58.8% | -179.7% | $28.3645 | $2.3211 | $0.9574 | $6.4919 |

| N | Search hit | Summary hit | Legacy hit | Naive answer | Search answer | Summary answer | Legacy answer |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100% | 0% | 0% | 100% | 100% | 0% | 0% |
| 10 | 70% | 90% | 50% | 100% | 70% | 70% | 60% |
| 50 | 80% | 92% | 64% | 100% | 80% | 76% | 70% |
| 100 | 79% | 93% | 65% | 100% | 79% | 79% | 72% |

Naive full-read is an upper bound: every page is in the prompt, so the expected string is always in that context (100% answer support). Summary-first hit means the gold page is one of the three summary candidates. It does not mean the body was opened.

At N=100, summary-first uses 957,371 tokens against search-then-read's 2,321,096 (58.8% fewer) and ranks the gold page 93% of the time against 79%. Answer support is tied at 79%. The legacy catalog policy uses 6,491,862 tokens and hits 65%. A negative "legacy vs search" percent means the catalog policy used more tokens than BM25. That is still true.

N=1 is the counterexample. `d01` (container sandboxes cannot be forked) is opened by search and missed by both ACP arms. Summary-first is cheaper on that question (27,963 vs 54,270) and does not contain the answer. `d02` (snapshot from a stopped sandbox) is a summary-first hit with no answer support, because the rule answered from summaries and the expected sentence is not in them. Search misses `d02` as well. `d05` is a search hit whose answer is in the opened page, and a summary-first hit whose answer is not in the summary, so the body stays closed.

Enrichment, counted once, from the local cache:

| Item | Value |
|---|---|
| Measured `buildUnifiedPrompt` input tokens (body truncated to 4000 characters) | 54,630 |
| Estimated output tokens (300 per page, not a completion) | 16,200 |
| Package `estimateEnrichmentCost` total | $0.1516 |
| Modeled fast-tier USD | $0.1356 |
| Summary-first break-even vs naive full-read | 1 fork |
| Summary-first break-even vs search-then-read | 5 forks (measured tokens), 12 forks (modeled USD) |
| Legacy catalog break-even vs search-then-read | not reached within 100,000 forks |
| Model spend that produced the metadata | $0 |

Charts: `results/scaling.svg` (naive sets the scale) and `results/scaling-search.svg` (search, summary-first, and the legacy catalog policy).
