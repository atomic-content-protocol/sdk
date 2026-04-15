# ACP Token Savings Benchmark

**Date:** 2026-04-15T12:53:05.783Z
**Model:** claude-haiku-4-5
**Documents:** 20 (avg ~784 tokens each)
**Query:** "Find the 3 most relevant documents about AI agent protocols and how they communicate with external tools."

## Results

| Method | Input tokens | Output tokens | Total cost | Latency | Selected docs |
|---|---|---|---|---|---|
| A: Raw documents | 13,682 | 244 | $0.0037 | 4,901ms | 1, 3, 8 |
| B: ACP frontmatter + deep read | 6,323 | 516 | $0.0022 | 7,596ms | 1, 3, 8 |
| C: ACP frontmatter only | 4,415 | 206 | $0.0014 | 3,608ms | 1, 3, 8 |

## Token Savings

| Comparison | Token reduction | Cost reduction | Speed improvement |
|---|---|---|---|
| A → B (frontmatter + deep read) | 50.9% fewer | 40.3% cheaper | -55.0% faster |
| A → C (frontmatter only) | 66.8% fewer | 63.5% cheaper | 26.4% faster |

## Accuracy

All three methods selected the same documents. ACP's structured metadata enables equivalent triage accuracy at a fraction of the token cost.

## Enrichment Investment

- One-time enrichment cost (20 docs): $0.0238
- Enrichment input tokens: 35,526
- Enrichment output tokens: 11,967
- Savings per triage (A vs B): $0.0015
- Savings per triage (A vs C): $0.0024
- Break-even A→B: 16 triages
- Break-even A→C: 11 triages

## Conclusion

ACP frontmatter-only triage (Run C) used 66.8% fewer tokens than raw-document triage (Run A) while selecting identical documents. The one-time enrichment cost of $0.0238 for 20 documents breaks even after 11 triage operations using frontmatter-only. For workloads where the same document corpus is triaged repeatedly, ACP structured metadata provides compounding cost savings with no loss of selection accuracy.
