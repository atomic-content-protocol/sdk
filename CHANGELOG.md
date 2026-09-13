# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **core:** `AuthorSchema` and `TokenCountsSchema` live once in `schema/common.schema.ts` (exported) instead of being copy-pasted into the ACO, Container and Collection schemas.
- **core:** `parseACO` / `serializeACO` share one YAML engine. Files always end with exactly one newline and `parseACO` strips exactly that one, so `parseACO(serializeACO(fm, body)).body === body` (previously bodies gained a trailing `\n` per cycle). `content_hash` is unaffected (it already trimmed).
- **core:** `ValidatedParseResult` is a discriminated union: `valid: true` narrows `frontmatter` to `ACOFrontmatter`.
- **core:** One export surface — `index.ts` re-exports `utils/index.ts` instead of hand-picking (which had drifted). Removed the unused `ACOParseResult` type and stale generation-era comments.
- **core:** `sideEffects: false` for bundlers; `@types/uuid` dropped (uuid ships types); `npm run lint` now type-checks the test files too.
- **docs:** Core README quick start compiles (`createACO` is async, `serializeACO(frontmatter, body)`); the root README no longer claims core runs in browsers — it uses `node:fs`/`node:crypto`/`node:dns`.

### Added
- **core:** Tests for `serializeACO` round-trip fidelity, the shared YAML engine, `getRelatedACOs` graph traversal (depth, cycles, rel-type filter, external targets, ordering) and the shared schema fragments.

### Security
- **server (hosted MCP):** `trust proxy` is now set (configurable via `TRUST_PROXY`, default 1 hop). Behind Railway every client previously shared the proxy's IP and therefore one global rate-limit bucket.
- **server:** `enrich_url` and batch URL items use core's SSRF-guarded `fetchPageForUrl` (HTTPS only, full private-range and DNS checks, no redirects, streamed 10 MB cap). The previous fetcher followed redirects to any address and buffered unbounded bodies.
- **server:** Optional bearer auth (`MCP_API_KEYS`), optional daily spend cap (`DAILY_COST_CAP_USD`, returns `BUDGET_EXCEEDED`), CORS restricted to `CORS_ORIGINS` (non-browser MCP clients unaffected), upstream provider error text no longer echoed to clients.
- **server:** Rate limit is weighted (a batch of N items costs N units), the MCP handshake is free, the key store is bounded (oldest-evicted), and a `Retry-After` header accompanies 429s.
- **website:** `/api/fetch-url` is no longer an open proxy: HTTPS only, private/loopback/link-local/NAT64 literals refused, no redirects, text-only, 1 MB streamed cap, same-origin or allow-listed `Origin` required, `Cache-Control: private, no-store`, upstream status preserved. The playground no longer falls back to third-party CORS proxies (which received every URL and page body).

### Changed
- **server:** Refactored into `config.ts` (validated env), `app.ts` (Express factory with injectable router), `EnrichmentService` (tool dispatch), `RateLimiter` / `SpendGuard`. Fresh MCP server/transport per request are now closed when the response ends. Tool failures set `isError: true`; unknown tools return a JSON-RPC method-not-found error; `$schema` is stripped from `inputSchema`. `express.json` limit sized for a full batch (previously 100 KB, smaller than one legal batch). Health reports version from `package.json`, provider flags, tier, auth and cap. PostHog shutdown is awaited on SIGTERM so buffered events are not lost; batch analytics record total cost, not the first item's. `ENRICHMENT_QUALITY` selects the model tier. Enrichment timeout is enforced by the router's circuit breaker (which aborts the HTTP request) instead of a race that left the call running.
- **core:** New `fetchPageForUrl()` returns text plus `title`, `ogImage`, `description`; `fetchBodyForUrl()` is a thin wrapper.

### Added
- **server:** First test suite (rate limiter, spend guard, config, HTTP integration against a fake provider: weights, CORS, auth, 413/400, SSRF refusals, batch errors, budget cap).
### Changed
- **mcp:** Each `ACPMCPServer` owns its own `ToolRegistry` and one shared, lazily-built enrichment provider (circuit-breaker state persists across calls). The module-level `registerTool`/`getAllTools`/… functions still work but are deprecated. New public `listTools()`, `callTool()`, `toolNames`, `close()`.
- **mcp:** `EnrichmentConfig` accepts `provider` (bring your own `IEnrichmentProvider`) and `routerOptions` in addition to `providers`.
- **mcp:** `update_aco` accepts `relationships` (validated against the core edge schema) and `body` (content_hash and token_counts recomputed); `detect_relationships` now points at it correctly.
- **mcp:** `find_similar` and `detect_relationships` no longer stop at 500 ACOs; they page through the whole vault. Cosine scores are calibrated (0.5 → 0, 1.0 → 1) so unrelated documents no longer pass as "high semantic similarity"; `detect_relationships` embeds the source once and reads stored vectors instead of embedding every candidate on every call.
- **mcp:** `enrich_aco` / `enrich_batch` accept the `embed` pipeline and persist the vector via `storage.putEmbedding`, so vector search can actually return results. Skip logic mirrors the pipelines' idempotency rule (`needsPipeline`) and is identical for single and batch. `enrich_batch` gains `concurrency` and reports `skipped` / `missing`.
- **mcp:** `list_acos` applies sort order and pagination after filters (previously ignored `sortBy`/`order` whenever a filter was set) and reports `total`.
- **mcp:** `delete_aco` returns an error for unknown ids instead of `deleted: true`; unknown tools return a JSON-RPC method-not-found error; `$schema` is stripped from `inputSchema`; source-type enums come from core instead of hand-copied lists; server name/version default to the package's.

### Added
- **mcp:** First test suite — 14 integration tests over a temp filesystem vault with a fake provider (registry isolation, CRUD round trip incl. relationships, sort-after-filter, idempotent enrichment, embed → find_similar → detect_relationships, overlap fallbacks, batch accounting).

### Changed
- **enrichment:** Idempotency now follows the spec's authorship rule. A field that already holds a non-empty value is left alone unless `force` is set — a value without a provenance record is treated as human-authored and is never overwritten implicitly. Empty values (`""`, `[]`, missing) are (re)generated. Applies to every pipeline. Previously human-written tags/summaries without provenance were silently replaced.
- **enrichment:** When a pipeline cannot extract a usable value it now returns the ACO unchanged and writes **no** provenance record, so the next run retries. Previously tag/entity pipelines wrote `[]` plus provenance, which made the field skip forever.
- **enrichment:** `CircuitBreaker` HALF_OPEN admits exactly one probe; concurrent callers get a `CircuitOpenError` without executing. A failed probe re-opens immediately. The request timeout now aborts the underlying HTTP call via `AbortSignal` (`CircuitTimeoutError`) instead of leaving it running. `execute(fn)` passes the signal to `fn`.
- **enrichment:** `ProviderRouter` forwards the breaker signal to providers, reports bypassed providers via `onProviderSkipped`, exposes `providers` (name/model/state) and `embeddingModel`, and `embedWithMeta` returns the embedding model rather than the chat model.
- **enrichment:** `ClassificationPipeline` classifies image/video ACOs deterministically from their source type without an LLM call.
- **enrichment:** Single-field pipelines share a `SingleFieldPipeline` base class (exported) and a fence/prose-tolerant `extractJsonArray()`.

### Added
- **enrichment:** `BatchEnricher.enrichMany(acos, { concurrency })` — bounded parallelism (default 1, unchanged behaviour). Results keep input order; `errors[]` now carries the input `index`.
- **enrichment:** `completeWithModel` / `structuredCompleteWithModel` / `embedWithModel` helpers and optional `*WithMeta` provider methods.

### Fixed
- **enrichment:** Provenance recorded the router's *primary* model even when a fallback provider answered (e.g. said `claude-haiku-4-5` after falling back to OpenAI). Every pipeline now records the model that actually produced the field.
- **enrichment:** `EmbedPipeline` provenance recorded the chat model instead of the embedding model.

### Added
- **enrichment:** Quality tiers. `ProviderRouter.fromConfig({ quality: "fast" | "balanced" | "best", ... })` picks default models per provider (`fast` → Claude Haiku 4.5 / GPT-5.6 Luna, `balanced` → Claude Sonnet 5 / GPT-5.6 Terra, `best` → Claude Opus 5 / GPT-5.6 Sol). Default `fast`; an explicit `model` still wins. Exposed as `MODEL_PRESETS`, `MODEL_PRICING`, `pricingFor()`.
- **enrichment:** `UnifiedOutputSchema` / `parseUnifiedOutput()` — Zod validation and normalisation of model output (tags lower-cased, de-duplicated, ≤ 20; summary ≤ 500 chars; entity types/confidence sanitised; language as ISO 639-1 or null). `UnifiedPipeline` runs every response through it before touching frontmatter.
- **enrichment:** `CompletionOptions.signal` (AbortSignal) is forwarded to every provider request; `embeddingModel` is configurable and exposed on OpenAI and Ollama providers; providers accept an injected client/fetch for testing.
- **enrichment:** `estimateEnrichmentCost(content, depth, { model | quality })` returns `cost` and `model` for the headline model and prices all six preset models in `estimatedCost`.

### Changed
- **enrichment:** OpenAI default model is now `gpt-5.6-luna` (was the two-generations-old `gpt-4o-mini`). Anthropic default stays `claude-haiku-4-5`.
- **enrichment:** Anthropic structured output uses `output_config.format` (JSON-schema constrained decoding) instead of forced tool use, so it works uniformly across Haiku 4.5, Sonnet 5 and Opus 5. Sampling parameters are omitted for models that reject them (Claude 5 family, Claude 4.7+).
- **enrichment:** OpenAI requests use `max_completion_tokens` and omit `temperature` for reasoning models (gpt-5.x, o-series), which reject it.
- **enrichment:** Ollama structured output passes the JSON schema as `format` (constrained decoding) and every Ollama request has a 120 s timeout.
- **enrichment:** Cost estimates count only the body actually sent to the model (≈4 000 chars) instead of the whole document.

### Fixed
- **enrichment:** Claude Haiku 4.5 was priced at Claude 3 Haiku rates ($0.25 / $1.25 per MTok). Correct list price is $1.00 / $5.00, so every estimate and the README's "~$0.002 per object" were roughly 4x too low.

### Security
- **core:** `FilesystemAdapter` now validates every object id against a strict allowlist before building a path. Previously an id such as `../escaped` (which can arrive from untrusted frontmatter) wrote and read files outside the vault.
- **core:** `fetchBodyForUrl` SSRF guard now covers the full set of non-public ranges (0/8, 100.64/10, 127/8, 169.254/16, RFC 1918, 192.0.0/24, TEST-NETs, 224/4, 240/4, `::`, `::1`, IPv4-mapped, NAT64, fc00::/7, fe80::/10, ff00::/8), refuses embedded credentials and single-label hostnames, and resolves hostnames before fetching so a public name pointing at a private IP is rejected. The 10 MB response cap is now enforced on the byte stream, not only on `Content-Length`.
- New export `isBlockedAddress()` so other layers can reuse the same range checks.

### Fixed
- **core:** Concurrent `putACO` / `deleteACO` calls no longer corrupt `.acp/index.json`. All writes are atomic (temp file + rename) and serialised behind a per-adapter lock. A corrupt or foreign index is rebuilt automatically instead of throwing.
- **core:** `token_counts.cl100k` was actually computed with the `o200k_base` encoding (GPT-4o). It now uses `cl100k_base` as documented, and the encoder is created once per process instead of per call.
- **core:** Network errors from Node's `fetch` carry their errno on `error.cause`; the SDK read the top-level `code` and therefore marked every DNS failure as retryable. `FetchError.networkCode` and `permanent` are now populated correctly.
- **core:** `deleteACO` removes the object's embedding; `findSimilar` skips vectors whose dimensions do not match the query instead of returning `NaN` scores; `putEmbedding` rejects empty or non-finite vectors.
- **core:** ACOs without a `status` are indexed as `draft` (the spec default) so `queryACOs({ status: ["draft"] })` matches them.

## [0.1.0] - 2026-04-16

### Added

#### @atomic-content-protocol/core
- Zod schemas for ACO, Container, and Collection (ported from ACP spec v0.4)
- Parse/serialize with gray-matter + js-yaml JSON_SCHEMA for lossless round-trips
- FilesystemAdapter with `.acp/index.json` cache and vector embedding storage
- Graph traversal for relationship edges (BFS with depth control)
- `createACO()`, `validateACO()`, `migrate()` convenience functions
- UUID v7 generation, SHA-256 content hashing with `normalizeBody()`
- Approximate and cl100k (tiktoken) token counting
- 130 unit tests

#### @atomic-content-protocol/enrichment
- Three LLM providers: Anthropic, OpenAI, Ollama (local)
- ProviderRouter with CircuitBreaker fallback chain
- Six enrichment pipelines: Tag, Summary, Entity, Classification, Unified (single-call), Embed
- BatchEnricher with series processing and progress callbacks
- Cost estimation with `estimateEnrichmentCost()`
- Idempotency: skip fields with existing provenance unless force=true
- 52 unit tests

#### @atomic-content-protocol/mcp
- 15 MCP tools: CRUD (5), Containers (3), Enrichment (3), Search (2), Vault (2)
- ACPMCPServer class with StdIO transport
- Tool handler pattern with Zod validation

#### @atomic-content-protocol/cli
- 8 commands: init, create, validate, enrich, enrich-batch, search, serve, stats
- Smart author resolution (CLI flags → config → git → prompt → unknown)
- Cost preview with confirmation prompts and --max-cost flag

#### Spec Website
- 13-page Astro + Starlight site at atomiccontentprotocol.org
- Interactive playground with live browser-side enrichment
- Token savings benchmark with real measured results (67% fewer tokens)
- Favicon and OG images designed in Figma

#### Hosted MCP Server
- Stateless HTTP MCP server for mcp.atomiccontentprotocol.org
- 3 enrichment tools: enrich_content, enrich_url, enrich_batch
- 50 requests/hour rate limiting per IP
- PostHog analytics for usage tracking
