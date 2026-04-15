---
title: Token Savings Benchmark
description: Real measured results proving ACP's token efficiency — 67% fewer tokens with identical accuracy.
---

Real API measurements comparing three methods of having an LLM triage 20 documents. No estimates — every number comes from actual `claude-haiku-4-5` API responses.

## Setup

- **20 documents** across 4 categories: AI/ML, web tech, business, general topics
- **Average document size:** ~784 tokens
- **Task:** "Find the 3 most relevant documents about AI agent protocols and how they communicate with external tools"
- **Model:** Claude Haiku 4.5
- **Date:** April 15, 2026

### Three methods tested

| Method | What the LLM receives |
|---|---|
| **A: Raw documents** | All 20 full document bodies (~15,000 tokens) |
| **B: ACP frontmatter + deep read** | 20 frontmatter blocks for triage, then 3 full documents for confirmation |
| **C: ACP frontmatter only** | 20 frontmatter blocks only (~200 tokens each) |

## Results

| Method | Input tokens | Output tokens | Total cost | Latency |
|---|---|---|---|---|
| A: Raw documents | 13,682 | 244 | $0.0037 | 4.9s |
| B: ACP frontmatter + deep read | 6,323 | 516 | $0.0022 | 7.6s |
| **C: ACP frontmatter only** | **4,415** | **206** | **$0.0014** | **3.6s** |

## Token Savings

| Comparison | Token reduction | Cost reduction | Speed |
|---|---|---|---|
| A → B (frontmatter + deep read) | **51% fewer** | **40% cheaper** | Slower (2 API calls) |
| A → C (frontmatter only) | **67% fewer** | **64% cheaper** | **26% faster** |

## Accuracy

**All three methods selected the exact same 3 documents.**

Documents selected: MCP overview (doc 1), AI Agent Frameworks (doc 3), REST vs GraphQL vs tRPC (doc 8 — discusses MCP as an agent protocol).

ACP's structured metadata (summary, tags, entities, classification) provides sufficient signal for accurate triage without reading full documents.

## Enrichment Investment

| Metric | Value |
|---|---|
| One-time enrichment cost (20 docs) | $0.024 |
| Cost per document | ~$0.001 |
| Savings per triage (A vs C) | $0.0024 |
| **Break-even** | **11 triages** |

After 11 triage operations, the enrichment has paid for itself. Every subsequent triage saves $0.0024. For a corpus that gets triaged daily, enrichment ROI is reached in under 2 weeks.

## The Math at Scale

| Corpus size | Enrichment cost | Savings per triage | Break-even |
|---|---|---|---|
| 20 docs | $0.024 | $0.0024 | 11 triages |
| 100 docs | $0.12 | $0.012 | 11 triages |
| 1,000 docs | $1.20 | $0.12 | 11 triages |
| 10,000 docs | $12.00 | $1.20 | 11 triages |

The break-even ratio is constant — it scales linearly. A 10,000-document knowledge base costs $12 to enrich and saves $1.20 on every triage pass.

## Why This Works

ACP enrichment creates a ~200 token frontmatter layer for each document containing:
- **Summary** — 2-sentence overview (replaces reading the full body for triage)
- **Tags** — keyword classification (enables filtering before reading)
- **Key entities** — typed entities with confidence scores (enables structured queries)
- **Classification** — content type (reference, tutorial, analysis, etc.)
- **Token counts** — exact size, so agents can budget context windows

An agent triaging with frontmatter reads **200 tokens per document** instead of **500–5,000 tokens**. The accuracy is identical because the metadata captures the essential signals.

## Reproduce This Benchmark

```bash
git clone https://github.com/atomic-content-protocol/sdk.git
cd sdk && npm install
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx examples/benchmark-token-savings.ts
```

The benchmark generates 20 documents, enriches them, runs all three methods, and produces a report. Total cost: ~$0.05.
