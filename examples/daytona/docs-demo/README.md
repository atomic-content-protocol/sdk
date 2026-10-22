# Daytona docs as ACOs

Fifty-four public Daytona product docs, fetched on 2026-10-22 from the pages listed by [llms.txt](https://www.daytona.io/docs/llms.txt), are stored here as cached markdown and as Atomic Content Objects. Fifteen developer questions have an expected answer string taken from the gold page. See [ATTRIBUTION.md](ATTRIBUTION.md) for what was included, what was skipped, and the copyright note.

Metadata is extractive: the first sentences, heading tags, and backtick identifiers. No model was called. `src/build-docs.ts` refreshes the fixture and mints new ACO ids.

## One command

From the repository root:

```bash
npm run measure:docs -w @atomic-content-protocol/example-daytona
```

Same three arms as the Wikipedia benchmark, same tokenizer (`cl100k_base`), same BM25 settings (k1=1.2, b=0.75, top 3), same Haiku 4.5 input price of $1 per million tokens. Output tokens are not included. These are not invoices. N=1 is question `d01` only. Larger N cycles the 15-question bank.

| N | Naive tokens | Search tokens | ACP tokens | ACP vs naive | ACP vs search | Naive $ | Search $ | ACP $ | Search hit | ACP hit | Search answer | ACP answer |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 283,650 | 54,270 | 71,081 | 74.9% | -31.0% | $0.2837 | $0.0543 | $0.0711 | 100% | 0% | 100% | 0% |
| 10 | 2,836,453 | 249,614 | 701,352 | 75.3% | -181.0% | $2.8365 | $0.2496 | $0.7014 | 70% | 50% | 70% | 60% |
| 50 | 14,182,255 | 1,197,618 | 3,250,792 | 77.1% | -171.4% | $14.1823 | $1.1976 | $3.2508 | 80% | 64% | 80% | 70% |
| 100 | 28,364,485 | 2,321,096 | 6,491,862 | 77.1% | -179.7% | $28.3645 | $2.3211 | $6.4919 | 79% | 65% | 79% | 72% |

Naive full-read is an upper bound: every page is in the prompt, so the expected string is always in that context (100% answer support) even when a reader would not find it. Search hit and ACP hit are the retrieval scores that matter.

At N=100, search-then-read uses 2,321,096 tokens and opens the gold page 79% of the time. ACP uses 6,491,862 tokens and opens the gold page 65% of the time. ACP is cheaper than stuffing every doc into the prompt, and more expensive than BM25, with a lower retrieval rate on this question set. A positive ACP-versus-search percent would mean ACP used fewer tokens. These percents are negative.

Two misses worth reading in `results/offline.md`: `d02` (snapshot from a stopped sandbox) was missed by both methods. `d01` (container fork) was opened by search and missed by ACP. `d06` (computer use) went the other way. ACP answer support can be true when retrieval misses, because the metadata catalog is part of the ACP context and a summary may already contain the expected string.

Enrichment, counted once:

| Item | Value |
|---|---|
| Measured `buildUnifiedPrompt` input tokens (body truncated to 4000 characters) | 54,630 |
| Estimated output tokens (300 per page, not a completion) | 16,200 |
| Package `estimateEnrichmentCost` total | $0.1516 |
| Modeled fast-tier USD | $0.1356 |
| Break-even vs naive full-read | 1 fork |
| Break-even vs search-then-read | not reached within 100,000 forks |
| Model spend that produced the committed metadata | $0 |

Charts: `results/scaling.svg` (all three arms; the naive line sets the scale) and `results/scaling-search.svg` (ACP against search-then-read).
