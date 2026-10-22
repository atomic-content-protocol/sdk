# Daytona ACP offline benchmark

Tokenizer: `cl100k_base` (tiktoken 1.0.22), counted with `computeTokenCounts` from `@atomic-content-protocol/core`.

Policy: `mcp-find-similar-top3`. Each question sends `list_acos` frontmatter for all 50 objects, `find_similar` content-overlap, and `read_aco` for the top 3 hits. The baseline sends every cached page body. The question bank has 20 questions. Fork counts above that cycle the bank (`question i % 20`).

Prices used for the dollar columns are `MODEL_PRICING["claude-haiku-4-5"]` input at $1 per million tokens. Output tokens are not included, because this run does not call a model. These are not invoices.

The repository README's 86% illustration (250,000 tokens down to 35,000 on 50 documents) is a different hypothetical. It is not this measurement.

## Per question

| Question | Baseline tokens | ACP tokens | Saved | Opened | Gold page opened | Answer string in ACP context |
|---|---:|---:|---:|---|---|---|
| q01 | 562,635 | 81,874 | 85.4% | alan-turing, printing-press, ada-lovelace | yes | yes |
| q02 | 562,634 | 81,796 | 85.5% | ada-lovelace, tcp, voyager-1 | yes | yes |
| q03 | 562,631 | 76,943 | 86.3% | grace-hopper, tim-berners-lee, quicksort | yes | yes |
| q04 | 562,634 | 65,121 | 88.4% | margaret-hamilton, linus-torvalds, postgresql | yes | yes |
| q05 | 562,631 | 69,969 | 87.6% | tim-berners-lee, sahara, mariana-trench | yes | yes |
| q06 | 562,628 | 81,650 | 85.5% | linus-torvalds, antikythera, tcp | yes | yes |
| q07 | 562,628 | 71,988 | 87.2% | python, rust, grace-hopper | yes | yes |
| q08 | 562,634 | 71,995 | 87.2% | rust, python, grace-hopper | yes | yes |
| q09 | 562,633 | 88,922 | 84.2% | postgresql, rsa, olympic-games | yes | yes |
| q10 | 562,635 | 83,217 | 85.2% | kubernetes, quicksort, turing-machine | yes | yes |
| q11 | 562,637 | 96,717 | 82.8% | tcp, periodic-table, kyoto-protocol | yes | yes |
| q12 | 562,636 | 84,804 | 84.9% | quicksort, alan-turing, tim-berners-lee | yes | yes |
| q13 | 562,637 | 93,751 | 83.3% | turing-machine, periodic-table, antikythera | yes | yes |
| q14 | 562,636 | 82,800 | 85.3% | public-key-cryptography, rsa, tcp | yes | yes |
| q15 | 562,640 | 84,308 | 85.0% | rsa, public-key-cryptography, quicksort | yes | yes |
| q16 | 562,634 | 82,059 | 85.4% | voyager-1, hubble, perseverance | yes | yes |
| q17 | 562,629 | 81,339 | 85.5% | apollo-11, perseverance, voyager-1 | yes | yes |
| q18 | 562,633 | 89,550 | 84.1% | hubble, voyager-1, james-webb | yes | yes |
| q19 | 562,629 | 95,152 | 83.1% | james-webb, hubble, antikythera | yes | yes |
| q20 | 562,630 | 78,042 | 86.1% | perseverance, apollo-11, margaret-hamilton | yes | yes |

## Fork scaling

Assembly time is local tokenization time, summed across the N assignments (a repeated question adds its measured time again). It is not sandbox boot time and not model latency.

| N | Baseline tokens | ACP tokens | Saved | Saved % | Baseline input $ | ACP input $ | $ saved | Retrieval hit | ACP answer support | Baseline answer support |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 562,635 | 81,874 | 480,761 | 85.4% | $0.5626 | $0.0819 | $0.4808 | 100.0% | 100.0% | 100.0% |
| 10 | 5,626,323 | 773,475 | 4,852,848 | 86.3% | $5.6263 | $0.7735 | $4.8528 | 100.0% | 100.0% | 100.0% |
| 50 | 28,131,651 | 4,057,469 | 24,074,182 | 85.6% | $28.1317 | $4.0575 | $24.0742 | 100.0% | 100.0% | 100.0% |
| 100 | 56,263,320 | 8,209,985 | 48,053,335 | 85.4% | $56.2633 | $8.2100 | $48.0533 | 100.0% | 100.0% | 100.0% |

![Context tokens by fork count](scaling.svg)

## Enrichment, counted once

Committed ACO metadata is extractive (Wikipedia lead, MediaWiki categories, a proper-noun scan). No model was called, so measured model spend for this corpus is $0. The figures below are the size of the real UnifiedPipeline prompt plus the package's estimated output, priced with MODEL_PRICING. They are not an invoice. buildUnifiedPrompt truncates each body to 4000 characters, which is what that prompt builder sends. A job that uploaded every full page would be larger.

| Item | Value |
|---|---|
| Measured UnifiedPipeline prompt input tokens (cl100k) | 50,696 |
| Estimated output tokens | 15,000 |
| Estimated output source | estimateEnrichmentCost(..., "standard") outputTokens constant, not a completion |
| Package `estimateEnrichmentCost` total (approximate tokenizer) | $0.1425 |
| Modeled fast-tier USD (measured input + estimated output) | $0.1257 |
| Break-even on measured tokens (savings vs measured prompt input) | 1 fork |
| Break-even on modeled USD (input-only read savings vs modeled enrichment) | 1 fork |
| Model spend that produced the committed metadata | $0 |

A break-even of 0 forks means the measured per-fork token saving already exceeds the one-time prompt, or the cost being compared is zero.

## Accuracy

Retrieval hit means every gold page for that question was one of the opened objects. Answer support means the expected answer string occurs in the context (baseline: full pages; ACP: the metadata catalog plus opened bodies). This is not a model grade. A live model can still answer wrongly from a context that contains the string.

## Caveats

- Page bodies are MediaWiki plaintext extracts, capped at 100,000 characters. `fetchPageForUrl` was also run; on these Wikipedia HTML pages it returns chrome and wikitext, which is recorded on the manifest and is not the body.
- Metadata was not produced by `UnifiedPipeline`. A model summary could be shorter or longer, and could rank differently.
- Cycling 20 questions to N=100 repeats the same work. It shows the fork curve, not 100 distinct questions.
- Input-only dollar savings ignore output tokens. Similar answer lengths on both sides would add about the same output cost to each and would not remove the input gap.
- Baseline prompts for this corpus are larger than a typical 200k-token context window. Stuffing every page into one call is what the token count measures. A live provider may reject that call. See the live harness.
