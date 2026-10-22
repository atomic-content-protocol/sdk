# Daytona ACP offline benchmark

Tokenizer: `cl100k_base` (tiktoken 1.0.22), counted with `computeTokenCounts` from `@atomic-content-protocol/core`.

Headline policy: `summary-first`. BM25 (k1=1.2, b=0.75) ranks title, summary, and tags only, and keeps the top 3. The prompt contains those compact summaries (slug, title, summary) and a decision line. A candidate covers the question when at least max(1, ceil(unique query terms * 0.5)) of those terms appear in its title, summary, or tags. If any candidate covers, no body is opened. Otherwise up to 3 full markdown bodies are opened. On this question bank, 8 of 15 questions were answered from summaries and opened no body. Summary-first tokens are the sum of two separate cl100k encodings: the decision prompt (instruction, question, summaries, and the decision line) plus the opened markdown. They are not one concatenated encoding, and the decision line is the policy string, not a model completion.

Variant `mcp-find-similar-top3` still puts `list_acos` frontmatter for all 54 objects in the prompt, plus `find_similar` content-overlap and `read_aco` JSON for the top 3. That variant is reported so the catalog cost stays visible.

Search-then-read runs the same BM25 settings over the raw title plus body, then sends the title and URL index, the top 3 ranking, and those full pages. Naive full-read sends every cached page body. It is an upper bound, not what a careful agent does. The question bank has 15 questions. Fork counts above that cycle the bank (`question i % 15`).

Prices used for the dollar columns are `MODEL_PRICING["claude-haiku-4-5"]` input at $1 per million tokens, applied to the measured cl100k totals. Output tokens are not included, because this run does not call a model. The decision line is priced as input, because it is text in the decision prompt. These are not invoices.

A positive "summary-first vs search" percent means summary-first used fewer input tokens than search-then-read. A negative percent means it used more. The same reading applies to the legacy column. Savings against the naive full-read are an upper bound.

The repository README's 86% illustration (250,000 tokens down to 35,000 on 50 documents) is a different hypothetical. It is not this measurement.

## Per question tokens

| Question | Naive | Search | Summary decision | Summary bodies | Summary-first | Legacy ACP |
|---|---:|---:|---:|---:|---:|---:|
| d01 | 283,650 | 54,270 | 238 | 27,725 | 27,963 | 71,081 |
| d02 | 283,642 | 20,745 | 214 | 0 | 214 | 76,648 |
| d03 | 283,648 | 19,104 | 265 | 41,912 | 42,177 | 81,525 |
| d04 | 283,649 | 27,649 | 197 | 15,727 | 15,924 | 64,515 |
| d05 | 283,650 | 40,109 | 244 | 0 | 244 | 61,768 |
| d06 | 283,640 | 6,226 | 212 | 0 | 212 | 80,960 |
| d07 | 283,645 | 21,264 | 247 | 0 | 247 | 68,318 |
| d08 | 283,650 | 17,492 | 283 | 11,800 | 12,083 | 67,088 |
| d09 | 283,638 | 23,832 | 228 | 0 | 228 | 67,223 |
| d10 | 283,641 | 18,923 | 240 | 24,265 | 24,505 | 62,226 |
| d11 | 283,647 | 9,114 | 280 | 9,925 | 10,205 | 51,222 |
| d12 | 283,638 | 39,216 | 216 | 0 | 216 | 48,806 |
| d13 | 283,646 | 14,183 | 218 | 4,042 | 4,260 | 53,866 |
| d14 | 283,643 | 19,540 | 199 | 0 | 199 | 60,492 |
| d15 | 283,645 | 13,580 | 252 | 0 | 252 | 49,347 |

## Per question retrieval

Summary-first hit means every gold slug is in the top-3 summary candidates. It does not mean the body was opened. Search hit and legacy hit mean every gold slug was opened. Answer support means the expected string is in that arm's shown context: search material, summary-first summaries plus opened markdown (not the question), or the legacy catalog plus opened JSON bodies. None of these is a model grade.

| Question | Search opened | Summary candidates | Decision | Summary bodies | Legacy opened | Search hit | Summary hit | Legacy hit | Search answer | Summary answer | Legacy answer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| d01 | linux-sandboxes, sandboxes, windows-sandboxes | windows-sandboxes, declarative-builder, snapshots | open | windows-sandboxes, declarative-builder, snapshots | windows-sandboxes, macos-sandboxes, snapshots | yes | no | no | yes | no | no |
| d02 | persistence, troubleshooting, billing | snapshots, windows-sandboxes, linux-sandboxes | answer | (none) | linux-sandboxes, windows-sandboxes, macos-sandboxes | no | yes | no | no | no | no |
| d03 | volumes, persistence, isolation | volumes, mount-external-storage, scale | open | volumes, mount-external-storage, scale | volumes, computer-use, scale | yes | yes | yes | yes | yes | yes |
| d04 | troubleshooting, network-limits, isolation | organizations, api-keys, network-limits | open | organizations, api-keys, network-limits | troubleshooting, organizations, warm-pools | yes | yes | no | yes | yes | no |
| d05 | vpn-connections, authentication, mount-external-storage | file-system-operations, authentication, preview | answer | (none) | file-system-operations, authentication, observability-otel-collection | yes | yes | yes | yes | no | yes |
| d06 | macos-sandboxes, vnc-access, playground | computer-use, vnc-access, file-system-operations | answer | (none) | process-code-execution, computer-use, git-operations | no | yes | yes | no | yes | yes |
| d07 | declarative-builder, snapshots, architecture | declarative-builder, gpu-sandboxes, file-system-operations | answer | (none) | declarative-builder, git-operations, file-system-operations | yes | yes | yes | yes | yes | yes |
| d08 | troubleshooting, typescript-sdk, warm-pools | warm-pools, authentication, volumes | open | warm-pools, authentication, volumes | macos-sandboxes, linux-sandboxes, warm-pools | yes | yes | yes | yes | yes | yes |
| d09 | vpn-connections, git-operations, isolation | ssh-access, authentication, secrets | answer | (none) | macos-sandboxes, linux-sandboxes, api-keys | no | yes | no | no | yes | yes |
| d10 | secrets, isolation, tools-api | secrets, file-system-operations, troubleshooting | open | secrets, file-system-operations, troubleshooting | git-operations, file-system-operations, macos-sandboxes | yes | yes | no | yes | yes | no |
| d11 | webhooks, limits, acceptable-use | webhooks, limits, tools-cli | open | webhooks, limits, tools-cli | webhooks, limits, linked-accounts | yes | yes | yes | yes | yes | yes |
| d12 | typescript-sdk, mount-external-storage, network-limits | typescript-sdk, tools-cli, agent-skills | answer | (none) | typescript-sdk, go-sdk, agent-skills | yes | yes | yes | yes | yes | yes |
| d13 | preview, isolation, tools-api | preview, custom-preview-proxy, ssh-access | open | preview, custom-preview-proxy, ssh-access | preview, isolation, regions | yes | yes | yes | yes | yes | yes |
| d14 | log-streaming, process-code-execution, declarative-builder | log-streaming, audit-logs, process-code-execution | answer | (none) | log-streaming, process-code-execution, audit-logs | yes | yes | yes | yes | yes | yes |
| d15 | regions, scale, acceptable-use | regions, warm-pools, scale | answer | (none) | regions, python-sdk, macos-sandboxes | yes | yes | yes | yes | yes | yes |

## Fork scaling

Assembly time in the JSON is local tokenization time, summed across the N assignments. It is not sandbox boot time and not model latency.

| N | Naive tokens | Search tokens | Summary-first tokens | Legacy tokens | Summary vs naive | Summary vs search | Legacy vs search | Naive $ | Search $ | Summary $ | Legacy $ |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 283,650 | 54,270 | 27,963 | 71,081 | 90.1% | 48.5% | -31.0% | $0.2837 | $0.0543 | $0.0280 | $0.0711 |
| 10 | 2,836,453 | 249,614 | 123,797 | 701,352 | 95.6% | 50.4% | -181.0% | $2.8365 | $0.2496 | $0.1238 | $0.7014 |
| 50 | 14,182,255 | 1,197,618 | 503,309 | 3,250,792 | 96.5% | 58.0% | -171.4% | $14.1823 | $1.1976 | $0.5033 | $3.2508 |
| 100 | 28,364,485 | 2,321,096 | 957,371 | 6,491,862 | 96.6% | 58.8% | -179.7% | $28.3645 | $2.3211 | $0.9574 | $6.4919 |

| N | Search hit | Summary hit | Legacy hit | Naive answer | Search answer | Summary answer | Legacy answer |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100.0% | 0.0% | 0.0% | 100.0% | 100.0% | 0.0% | 0.0% |
| 10 | 70.0% | 90.0% | 50.0% | 100.0% | 70.0% | 70.0% | 60.0% |
| 50 | 80.0% | 92.0% | 64.0% | 100.0% | 80.0% | 76.0% | 70.0% |
| 100 | 79.0% | 93.0% | 65.0% | 100.0% | 79.0% | 79.0% | 72.0% |

![Context tokens by fork count](scaling.svg)

![Summary-first, legacy ACP, and search-then-read](scaling-search.svg)

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
| Summary-first break-even vs search-then-read, measured tokens | 5 forks |
| Summary-first break-even vs search-then-read, modeled USD | 12 forks |
| Legacy catalog break-even vs naive full-read, measured tokens | 1 fork |
| Legacy catalog break-even vs search-then-read, measured tokens | not reached within 100,000 forks |
| Model spend that produced the committed metadata | $0 |

A break-even of 0 forks means the measured per-fork token saving already exceeds the one-time prompt, or the cost being compared is zero. "Not reached" means that arm never saves tokens against the comparison, so enrichment is not paid back by the read path.

## Accuracy

Summary-first retrieval hit means every gold page was one of the summary candidates. Answer support means the expected answer string occurs in the compact summaries or in a markdown body that the coverage rule opened. Legacy retrieval hit means every gold page was opened by `find_similar`. This is not a model grade. A live model can still answer wrongly from a context that contains the string.

## Caveats

- Naive full-read is an upper bound. Search-then-read is the realistic baseline: BM25 over raw text, top 3.
- Summary-first does not put the full metadata catalog in the prompt. The MCP server's `find_similar` returns only id, title, and similarity_score. `list_acos` returns every object's full frontmatter and cannot return compact summaries for a filtered id set. `read_aco` returns pretty JSON, not markdown. A small SDK addition that would match this policy is `read_summaries({ ids })` returning `{ id, title, summary }[]`, plus a markdown format on `read_aco`. This demo ranks frontmatter with the local helper and opens markdown from the page cache. It does not change SDK packages.
- The offline decision is the coverage rule above, not a Haiku completion. A live run sends that same context in one model call. Provider usage on the concatenated prompt can differ slightly from the sum of the two offline encodings.
- Page bodies for the Wikipedia corpus are MediaWiki plaintext extracts, capped at 100,000 characters. `fetchPageForUrl` on those HTML pages returns chrome and wikitext, which is recorded on the manifest and is not the body. The docs demo uses markdown fetched from the docs index. That raw text is not committed. `src/build-docs.ts` regenerates it locally.
- Metadata was not produced by `UnifiedPipeline`. A model summary could be shorter or longer, and could rank differently.
- Cycling the question bank out to N=100 repeats the same work. It shows the fork curve, not that many distinct questions.
- Input-only dollar figures ignore model output tokens. Similar answer lengths on both sides would add about the same output cost to each and would not remove the input gap.
- Naive prompts for the Wikipedia corpus are larger than a typical 200k-token context window. The live harness uses search-then-read as the non-ACP arm by default. Set `ACP_LIVE_BASELINE=naive` or `both` to also send the upper bound. The ACP arm of a live run is summary-first.
