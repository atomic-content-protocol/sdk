# Daytona ACP offline benchmark

Tokenizer: `cl100k_base` (tiktoken 1.0.22), counted with `computeTokenCounts` from `@atomic-content-protocol/core`.

Policy: `mcp-find-similar-top3`. ACP sends `list_acos` frontmatter for all 50 objects, `find_similar` content-overlap, and `read_aco` for the top 3 hits. Search-then-read runs Okapi BM25 (k1=1.2, b=0.75) over the raw title plus body, then sends the title and URL index, the top 3 ranking, and those full pages. Naive full-read sends every cached page body. It is an upper bound, not what a careful agent does. The question bank has 20 questions. Fork counts above that cycle the bank (`question i % 20`).

Prices used for the dollar columns are `MODEL_PRICING["claude-haiku-4-5"]` input at $1 per million tokens. Output tokens are not included, because this run does not call a model. These are not invoices.

A positive "ACP vs search" percent means ACP used fewer input tokens than search-then-read. A negative percent means ACP used more. Savings against the naive full-read are an upper bound.

The repository README's 86% illustration (250,000 tokens down to 35,000 on 50 documents) is a different hypothetical. It is not this measurement.

## Per question

| Question | Naive tokens | Search tokens | ACP tokens | Search opened | ACP opened | Search hit | ACP hit | Search answer | ACP answer |
|---|---:|---:|---:|---|---|---|---|---|---|
| q01 | 562,635 | 31,602 | 81,874 | alan-turing, public-key-cryptography, rsa | alan-turing, printing-press, ada-lovelace | yes | yes | yes | yes |
| q02 | 562,634 | 34,612 | 81,796 | ada-lovelace, alan-turing, turing-machine | ada-lovelace, tcp, voyager-1 | yes | yes | yes | yes |
| q03 | 562,631 | 38,900 | 76,943 | grace-hopper, apollo-11, antikythera | grace-hopper, tim-berners-lee, quicksort | yes | yes | yes | yes |
| q04 | 562,634 | 37,560 | 65,121 | margaret-hamilton, apollo-11, james-webb | margaret-hamilton, linus-torvalds, postgresql | yes | yes | yes | yes |
| q05 | 562,631 | 26,620 | 69,969 | tim-berners-lee, postgresql, antikythera | tim-berners-lee, sahara, mariana-trench | yes | yes | yes | yes |
| q06 | 562,628 | 18,603 | 81,650 | linus-torvalds, rust, kubernetes | linus-torvalds, antikythera, tcp | yes | yes | yes | yes |
| q07 | 562,628 | 24,060 | 71,988 | python, rust, grace-hopper | python, rust, grace-hopper | yes | yes | yes | yes |
| q08 | 562,634 | 25,567 | 71,995 | rust, python, postgresql | rust, python, grace-hopper | yes | yes | yes | yes |
| q09 | 562,633 | 36,592 | 88,922 | postgresql, hubble, python | postgresql, rsa, olympic-games | yes | yes | yes | yes |
| q10 | 562,635 | 19,383 | 83,217 | kubernetes, postgresql, linus-torvalds | kubernetes, quicksort, turing-machine | yes | yes | yes | yes |
| q11 | 562,637 | 28,744 | 96,717 | tcp, rust, public-key-cryptography | tcp, periodic-table, kyoto-protocol | yes | yes | yes | yes |
| q12 | 562,636 | 49,990 | 84,804 | quicksort, alan-turing, pi | quicksort, alan-turing, tim-berners-lee | yes | yes | yes | yes |
| q13 | 562,637 | 35,504 | 93,751 | turing-machine, ada-lovelace, go-game | turing-machine, periodic-table, antikythera | yes | yes | yes | yes |
| q14 | 562,636 | 32,905 | 82,800 | public-key-cryptography, rsa, tcp | public-key-cryptography, rsa, tcp | yes | yes | yes | yes |
| q15 | 562,640 | 32,202 | 84,308 | rsa, public-key-cryptography, quicksort | rsa, public-key-cryptography, quicksort | yes | yes | yes | yes |
| q16 | 562,634 | 41,543 | 82,059 | voyager-1, hubble, james-webb | voyager-1, hubble, perseverance | yes | yes | yes | yes |
| q17 | 562,629 | 30,151 | 81,339 | apollo-11, perseverance, margaret-hamilton | apollo-11, perseverance, voyager-1 | yes | yes | yes | yes |
| q18 | 562,633 | 51,542 | 89,550 | hubble, james-webb, apollo-11 | hubble, voyager-1, james-webb | yes | yes | yes | yes |
| q19 | 562,629 | 51,538 | 95,152 | james-webb, hubble, apollo-11 | james-webb, hubble, antikythera | yes | yes | yes | yes |
| q20 | 562,630 | 44,135 | 78,042 | perseverance, apollo-11, hubble | perseverance, apollo-11, margaret-hamilton | yes | yes | yes | yes |

## Fork scaling

Assembly time is local tokenization time, summed across the N assignments (a repeated question adds its measured time again). It is not sandbox boot time and not model latency. Naive answer support is the expected string inside the full page text. Search answer support is the string inside the search prompt material. ACP answer support is the string inside the metadata catalog plus opened bodies. Retrieval hit means every gold page was opened. None of these is a model grade.

| N | Naive tokens | Search tokens | ACP tokens | ACP vs naive | ACP vs search | Naive $ | Search $ | ACP $ | Naive answer | Search hit | Search answer | ACP hit | ACP answer |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 562,635 | 31,602 | 81,874 | 85.4% | -159.1% | $0.5626 | $0.0316 | $0.0819 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 10 | 5,626,323 | 293,499 | 773,475 | 86.3% | -163.5% | $5.6263 | $0.2935 | $0.7735 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 50 | 28,131,651 | 1,677,005 | 4,057,469 | 85.6% | -141.9% | $28.1317 | $1.6770 | $4.0575 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 100 | 56,263,320 | 3,458,765 | 8,209,985 | 85.4% | -137.4% | $56.2633 | $3.4588 | $8.2100 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |

![Context tokens by fork count](scaling.svg)

![ACP and search-then-read](scaling-search.svg)

The first chart uses the naive upper bound as its scale, so the other two lines sit near the bottom. The second chart is only search-then-read and ACP.

## Enrichment, counted once

Committed ACO metadata is extractive (Wikipedia lead, MediaWiki categories, a proper-noun scan). No model was called, so measured model spend for this corpus is $0. The figures below are the size of the real UnifiedPipeline prompt plus the package's estimated output, priced with MODEL_PRICING. They are not an invoice. buildUnifiedPrompt truncates each body to 4000 characters, which is what that prompt builder sends. A job that uploaded every full page would be larger. Break-even against the naive full-read is an upper bound. Break-even against search-then-read is the realistic comparison. Null means ACP did not accumulate a token or dollar saving against that arm within 100,000 forks.

| Item | Value |
|---|---|
| Measured UnifiedPipeline prompt input tokens (cl100k) | 50,696 |
| Estimated output tokens | 15,000 |
| Estimated output source | estimateEnrichmentCost(..., "standard") outputTokens constant, not a completion |
| Package `estimateEnrichmentCost` total (approximate tokenizer) | $0.1425 |
| Modeled fast-tier USD (measured input + estimated output) | $0.1257 |
| Break-even vs naive full-read, measured tokens | 1 fork |
| Break-even vs naive full-read, modeled USD | 1 fork |
| Break-even vs search-then-read, measured tokens | not reached within 100,000 forks |
| Break-even vs search-then-read, modeled USD | not reached within 100,000 forks |
| Model spend that produced the committed metadata | $0 |

A break-even of 0 forks means the measured per-fork token saving already exceeds the one-time prompt, or the cost being compared is zero.

## Accuracy

Retrieval hit means every gold page for that question was one of the opened objects. Answer support means the expected answer string occurs in that arm's context. This is not a model grade. A live model can still answer wrongly from a context that contains the string.

## Caveats

- Naive full-read is an upper bound. It stuffs every page into one prompt. Search-then-read is the realistic baseline: BM25 over raw text, top 3, same k as ACP.
- The ACP prompt still includes the full metadata catalog plus three opened objects. That catalog can cost more tokens than a title and URL index plus three raw pages.
- Page bodies for the Wikipedia corpus are MediaWiki plaintext extracts, capped at 100,000 characters. `fetchPageForUrl` on those HTML pages returns chrome and wikitext, which is recorded on the manifest and is not the body. The docs demo uses the markdown files from the docs index instead.
- Metadata was not produced by `UnifiedPipeline`. A model summary could be shorter or longer, and could rank differently.
- Cycling the question bank out to N=100 repeats the same work. It shows the fork curve, not that many distinct questions.
- Input-only dollar savings ignore output tokens. Similar answer lengths on both sides would add about the same output cost to each and would not remove the input gap.
- Naive prompts for the Wikipedia corpus are larger than a typical 200k-token context window. The live harness uses search-then-read by default so the comparison call can fit. Set `ACP_LIVE_BASELINE=naive` or `both` to also send the upper bound.
