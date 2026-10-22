# Daytona ACP offline benchmark

Tokenizer: `cl100k_base` (tiktoken 1.0.22), counted with `computeTokenCounts` from `@atomic-content-protocol/core`.

Headline policy: `summary-first`. BM25 (k1=1.2, b=0.75) ranks title, summary, and tags only, and keeps the top 3. The decision prompt shows those compact summaries and asks for an answer or `OPEN slug`. Offline cannot call the model, so a conservative proxy decides. It opens the top body unless every query term is in the top candidate's title, summary, and tags, the runner-up covers less than 0.5 of those terms, and the second score is below 0.85 of the first. When the top two scores are that close it opens both. It never opens more than 2 bodies. The proxy does not read the expected answer. On this question bank, 0 of 15 questions stayed on summaries. Summary-first tokens are two cl100k encodings added together: the decision prompt, plus a second prompt (instruction, question, and opened markdown) when a body is opened.

Variant `summary-first-v1` is the previous term-coverage rule, kept for comparison and not retuned: a candidate covers when at least max(1, ceil(unique query terms * 0.5)) of those terms appear in its title, summary, or tags. If any of the top 3 covers, no body is opened. Otherwise up to 3 bodies are opened. Its token total is the decision prompt (including the decision line) plus the opened markdown, the same two encodings as before.

Variant `mcp-find-similar-top3` still puts `list_acos` frontmatter for all 54 objects in the prompt, plus `find_similar` content-overlap and `read_aco` JSON for the top 3. That variant is reported so the catalog cost stays visible.

Search-then-read runs the same BM25 settings over the raw title plus body, then sends the title and URL index, the top 3 ranking, and those full pages. Naive full-read sends every cached page body. It is an upper bound, not what a careful agent does. The question bank has 15 questions. Fork counts above that cycle the bank (`question i % 15`).

Prices used for the dollar columns are `MODEL_PRICING["claude-haiku-4-5"]` input at $1 per million tokens, applied to the measured cl100k totals. Output tokens are not included, because this run does not call a model. The decision line is priced as input, because it is text in the decision prompt. These are not invoices.

A positive "summary-first vs search" percent means summary-first used fewer input tokens than search-then-read. A negative percent means it used more. The same reading applies to the v1 and legacy columns. Savings against the naive full-read are an upper bound.

The repository README's 86% illustration (250,000 tokens down to 35,000 on 50 documents) is a different hypothetical. It is not this measurement.

## Per question tokens

| Question | Naive | Search | Summary decision | Summary bodies | Summary-first | v1 | Legacy ACP |
|---|---:|---:|---:|---:|---:|---:|---:|
| d01 | 283,650 | 54,270 | 280 | 16,381 | 16,661 | 27,963 | 71,138 |
| d02 | 283,642 | 20,745 | 264 | 21,954 | 22,218 | 214 | 76,715 |
| d03 | 283,648 | 19,104 | 309 | 7,420 | 7,729 | 42,177 | 81,582 |
| d04 | 283,649 | 27,649 | 241 | 6,458 | 6,699 | 15,924 | 64,594 |
| d05 | 283,650 | 40,109 | 294 | 6,416 | 6,710 | 244 | 61,837 |
| d06 | 283,640 | 6,226 | 262 | 14,992 | 15,254 | 212 | 81,011 |
| d07 | 283,645 | 21,264 | 297 | 5,841 | 6,138 | 247 | 68,375 |
| d08 | 283,650 | 17,492 | 328 | 2,174 | 2,502 | 12,083 | 67,155 |
| d09 | 283,638 | 23,832 | 278 | 1,043 | 1,321 | 228 | 67,282 |
| d10 | 283,641 | 18,923 | 284 | 6,649 | 6,933 | 24,505 | 62,279 |
| d11 | 283,647 | 9,114 | 325 | 2,686 | 3,011 | 10,205 | 51,285 |
| d12 | 283,638 | 39,216 | 266 | 1,670 | 1,936 | 216 | 48,863 |
| d13 | 283,646 | 14,183 | 262 | 1,911 | 2,173 | 4,260 | 53,925 |
| d14 | 283,643 | 19,540 | 249 | 3,348 | 3,597 | 199 | 60,563 |
| d15 | 283,645 | 13,580 | 302 | 1,242 | 1,544 | 252 | 49,408 |

## Per question retrieval

Summary-first hit and v1 hit mean every gold slug is in the top-3 summary candidates. They do not mean the body was opened. Search hit and legacy hit mean every gold slug was opened. Answer support means the expected string is in that arm's shown context: search material, summary-first summaries plus opened markdown (not the question), the v1 summaries plus the bodies that rule opened, or the legacy catalog plus opened JSON bodies. None of these is a model grade.

| Question | Search opened | Summary candidates | Decision | Summary bodies | v1 decision | v1 bodies | Search hit | Summary hit | v1 hit | Search answer | Summary answer | v1 answer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| d01 | linux-sandboxes, sandboxes, windows-sandboxes | windows-sandboxes, declarative-builder, snapshots | open | windows-sandboxes, declarative-builder | open | windows-sandboxes, declarative-builder, snapshots | yes | no | no | yes | no | no |
| d02 | persistence, troubleshooting, billing | snapshots, windows-sandboxes, linux-sandboxes | open | snapshots, windows-sandboxes | answer | (none) | no | yes | yes | no | yes | no |
| d03 | volumes, persistence, isolation | volumes, mount-external-storage, scale | open | volumes | open | volumes, mount-external-storage, scale | yes | yes | yes | yes | yes | yes |
| d04 | troubleshooting, network-limits, isolation | organizations, api-keys, network-limits | open | organizations, api-keys | open | organizations, api-keys, network-limits | yes | yes | yes | yes | no | yes |
| d05 | vpn-connections, authentication, mount-external-storage | file-system-operations, authentication, preview | open | file-system-operations | answer | (none) | yes | yes | yes | yes | no | no |
| d06 | macos-sandboxes, vnc-access, playground | computer-use, vnc-access, file-system-operations | open | computer-use | answer | (none) | no | yes | yes | no | yes | yes |
| d07 | declarative-builder, snapshots, architecture | declarative-builder, gpu-sandboxes, file-system-operations | open | declarative-builder | answer | (none) | yes | yes | yes | yes | yes | yes |
| d08 | troubleshooting, typescript-sdk, warm-pools | warm-pools, authentication, volumes | open | warm-pools | open | warm-pools, authentication, volumes | yes | yes | yes | yes | yes | yes |
| d09 | vpn-connections, git-operations, isolation | ssh-access, authentication, secrets | open | ssh-access | answer | (none) | no | yes | yes | no | yes | yes |
| d10 | secrets, isolation, tools-api | secrets, file-system-operations, troubleshooting | open | secrets | open | secrets, file-system-operations, troubleshooting | yes | yes | yes | yes | yes | yes |
| d11 | webhooks, limits, acceptable-use | webhooks, limits, tools-cli | open | webhooks | open | webhooks, limits, tools-cli | yes | yes | yes | yes | yes | yes |
| d12 | typescript-sdk, mount-external-storage, network-limits | typescript-sdk, tools-cli, agent-skills | open | typescript-sdk | answer | (none) | yes | yes | yes | yes | yes | yes |
| d13 | preview, isolation, tools-api | preview, custom-preview-proxy, ssh-access | open | preview | open | preview, custom-preview-proxy, ssh-access | yes | yes | yes | yes | yes | yes |
| d14 | log-streaming, process-code-execution, declarative-builder | log-streaming, audit-logs, process-code-execution | open | log-streaming | answer | (none) | yes | yes | yes | yes | yes | yes |
| d15 | regions, scale, acceptable-use | regions, warm-pools, scale | open | regions | answer | (none) | yes | yes | yes | yes | yes | yes |

## Fork scaling

Assembly time in the JSON is local tokenization time, summed across the N assignments. It is not sandbox boot time and not model latency.

| N | Naive tokens | Search tokens | Summary-first tokens | v1 tokens | Legacy tokens | Summary vs search | v1 vs search | Legacy vs search | Search $ | Summary $ | v1 $ | Legacy $ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 283,650 | 54,270 | 16,661 | 27,963 | 71,138 | 69.3% | 48.5% | -31.1% | $0.0543 | $0.0167 | $0.0280 | $0.0711 |
| 10 | 2,836,453 | 249,614 | 92,165 | 123,797 | 701,968 | 63.1% | 50.4% | -181.2% | $0.2496 | $0.0922 | $0.1238 | $0.7020 |
| 50 | 14,182,255 | 1,197,618 | 373,295 | 503,309 | 3,253,902 | 68.8% | 58.0% | -171.7% | $1.1976 | $0.3733 | $0.5033 | $3.2539 |
| 100 | 28,364,485 | 2,321,096 | 718,721 | 957,371 | 6,498,040 | 69.0% | 58.8% | -180.0% | $2.3211 | $0.7187 | $0.9574 | $6.4980 |

| N | Search hit | Summary hit | v1 hit | Search answer | Summary answer | v1 answer | Legacy answer |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100.0% | 0.0% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% |
| 10 | 70.0% | 90.0% | 90.0% | 70.0% | 70.0% | 70.0% | 60.0% |
| 50 | 80.0% | 92.0% | 92.0% | 80.0% | 76.0% | 76.0% | 70.0% |
| 100 | 79.0% | 93.0% | 93.0% | 79.0% | 79.0% | 79.0% | 72.0% |

![Context tokens by fork count](scaling.svg)

![Summary-first, v1, legacy ACP, and search-then-read](scaling-search.svg)

The first chart uses the naive upper bound as its scale, so the other lines sit near the bottom. The second chart is search-then-read, summary-first, and the legacy catalog policy.

## Enrichment, counted once

ACO metadata is extractive (the first sentences of each Daytona doc, heading tags, and backtick identifiers). No model was called, so measured model spend for this corpus is $0. The figures below are the size of the real UnifiedPipeline prompt plus the package's estimated output, priced with MODEL_PRICING. They are not an invoice. buildUnifiedPrompt truncates each body to 4000 characters, which is what that prompt builder sends. A job that uploaded every full page would be larger. Break-even for the headline summary-first policy is against the naive full-read (an upper bound) and against search-then-read. The legacy catalog policy has its own break-even rows. Null means that policy did not accumulate a token saving against that arm within 100,000 forks. Raw Daytona page text is not committed. This measurement reads a local cache produced by src/build-docs.ts.

| Item | Value |
|---|---|
| Measured UnifiedPipeline prompt input tokens (cl100k) | 54,630 |
| Estimated output tokens | 16,200 |
| Estimated output source | estimateEnrichmentCost(..., "standard") outputTokens constant, not a completion |
| Package `estimateEnrichmentCost` total (approximate tokenizer) | $0.1516 |
| Modeled fast-tier USD (measured input + estimated output) | $0.1356 |
| Summary-first break-even vs naive full-read, measured tokens | 1 fork |
| Summary-first break-even vs naive full-read, modeled USD | 1 fork |
| Summary-first break-even vs search-then-read, measured tokens | 4 forks |
| Summary-first break-even vs search-then-read, modeled USD | 9 forks |
| Legacy catalog break-even vs naive full-read, measured tokens | 1 fork |
| Legacy catalog break-even vs search-then-read, measured tokens | not reached within 100,000 forks |
| Summary-first v1 break-even vs search-then-read, measured tokens | 5 forks |
| Model spend that produced the committed metadata | $0 |

A break-even of 0 forks means the measured per-fork token saving already exceeds the one-time prompt, or the cost being compared is zero. "Not reached" means that arm never saves tokens against the comparison, so enrichment is not paid back by the read path.

## Accuracy

Summary-first retrieval hit means every gold page was one of the summary candidates. Answer support means the expected answer string occurs in the compact summaries or in a markdown body the proxy opened. The v1 column uses the old coverage rule for which bodies open. Legacy retrieval hit means every gold page was opened by `find_similar`. This is not a model grade. A live model can still answer wrongly from a context that contains the string. The recorded live docs run used v1, and its model answers were less accurate than search-then-read.

## Caveats

- Naive full-read is an upper bound. Search-then-read is the realistic baseline: BM25 over raw text, top 3.
- Summary-first does not put the full metadata catalog in the prompt. The MCP server's `find_similar` returns only id, title, and similarity_score. `list_acos` returns every object's full frontmatter and cannot return compact summaries for a filtered id set. `read_aco` returns pretty JSON, not markdown. A small SDK addition that would match this policy is `read_summaries({ ids })` returning `{ id, title, summary }[]`, plus a markdown format on `read_aco`. This demo ranks frontmatter with the local helper and opens markdown from the page cache. It does not change SDK packages.
- The offline headline decision is the proxy above, not a Haiku completion. A live run sends the summaries and lets the model answer or reply OPEN. When that reply is missing or uncertain, the harness opens the same bodies the proxy would. v1 still sends one concatenated call with the coverage decision already written in. Provider usage can differ from these cl100k sums.
- Page bodies for the Wikipedia corpus are MediaWiki plaintext extracts, capped at 100,000 characters. `fetchPageForUrl` on those HTML pages returns chrome and wikitext, which is recorded on the manifest and is not the body. The docs demo uses markdown fetched from the docs index. That raw text is not committed. `src/build-docs.ts` regenerates it locally.
- Metadata was not produced by `UnifiedPipeline`. A model summary could be shorter or longer, and could rank differently.
- Cycling the question bank out to N=100 repeats the same work. It shows the fork curve, not that many distinct questions.
- Input-only dollar figures ignore model output tokens. Similar answer lengths on both sides would add about the same output cost to each and would not remove the input gap.
- Naive prompts for the Wikipedia corpus are larger than a typical 200k-token context window. The live harness uses search-then-read as the non-ACP arm by default. Set `ACP_LIVE_BASELINE=naive` or `both` to also send the upper bound. The ACP arm of a live run is summary-first.
