# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-14

All four packages move to 0.2.0 together. Highlights: the storage layer and both public HTTP surfaces are hardened against path traversal and SSRF, enrichment records truthful provenance and never overwrites human-authored fields, vector search works end to end, quality tiers select current models, and every workspace has a test suite (core 347, enrichment 163, mcp 15, server 30, cli 18).

### Upgrade notes
- Enrichment idempotency changed: fields with existing values are no longer overwritten unless `force` is passed. Pass `force: true` to reproduce the old behaviour.
- `enrich_url` / hosted server: `http://` URLs and redirecting URLs are refused by design.
- OpenAI default model is `gpt-5.6-luna`; Anthropic default stays `claude-haiku-4-5`. Set `quality` to change tiers.
- Cost estimates roughly quadrupled for Haiku 4.5 because the previous price table was wrong; actual spend is unchanged.
- `CircuitBreaker.execute` callbacks now receive an `AbortSignal`; `CostEstimate` gained `cost` and `model`.
- Known gaps carried to 0.3: browser-safe subpath export for core schemas; optional peer dependencies for the AI SDKs; spec-conditional field requirements as validation warnings.

### Security
- **core / website:** URL fetching now follows redirects (up to 5 hops) instead of refusing them, with **every hop** re-validated against the full SSRF guard — scheme, blocked hosts, literal IP ranges and DNS resolution. Refusing redirects was equally safe but rejected ordinary URLs (moved pages, `www.` and trailing-slash canonicalisation, `http`→`https`); an open redirector still cannot reach a private address or downgrade the scheme. `FetchedPage.url` is the final URL, so `source_url` records where the content actually came from.
- **core:** `serializeACO` no longer routes the body through gray-matter's `stringify`, which parsed the body as a frontmatter document: a body beginning with `---` could inject keys such as `visibility: public` into the saved frontmatter or lose its first paragraph. Files are now assembled directly; the body is written verbatim. (Present since 0.1.)
- **core:** HTML text/metadata extraction in `fetchPageForUrl` is linear-time (single-pass tag scans, bounded-length patterns, 300 KB cap). The previous regexes were quadratic on adversarial pages (tens of seconds to minutes of CPU per request), which made the hosted server's `enrich_url` a CPU DoS vector.
- **core:** IPv6 SSRF checks also cover IPv4-compatible (`::a.b.c.d`), 6to4 (`2002::/16`), Teredo (`2001::/32`), discard (`100::/64`) and local-use NAT64 (`64:ff9b:1::/48`) ranges.
- **website:** The playground keeps the user's Anthropic key in `sessionStorage` (cleared when the tab closes) instead of `localStorage`, and says so in the UI.
- **core:** `FilesystemAdapter` now validates every object id against a strict allowlist before building a path. Previously an id such as `../escaped` (which can arrive from untrusted frontmatter) wrote and read files outside the vault.
- **core:** `fetchBodyForUrl` SSRF guard now covers the full set of non-public ranges (0/8, 100.64/10, 127/8, 169.254/16, RFC 1918, 192.0.0/24, TEST-NETs, 224/4, 240/4, `::`, `::1`, IPv4-mapped, NAT64, fc00::/7, fe80::/10, ff00::/8), refuses embedded credentials and single-label hostnames, and resolves hostnames before fetching so a public name pointing at a private IP is rejected. The 10 MB response cap is now enforced on the byte stream, not only on `Content-Length`.
- **server:** `enrich_url` and batch URL items use core's SSRF-guarded `fetchPageForUrl` (HTTPS only, full private-range and DNS checks, no redirects, streamed 10 MB cap). The previous fetcher followed redirects to any address and buffered unbounded bodies.
- **server:** Optional bearer auth (`MCP_API_KEYS`), optional daily spend cap (`DAILY_COST_CAP_USD`, returns `BUDGET_EXCEEDED`), CORS restricted to `CORS_ORIGINS` (non-browser MCP clients unaffected), upstream provider error text no longer echoed to clients.
- **server:** Rate limit is weighted (a batch of N items costs N units), the MCP handshake is free, the key store is bounded (oldest-evicted), and a `Retry-After` header accompanies 429s.
- **server (hosted MCP):** `trust proxy` is now set (configurable via `TRUST_PROXY`, default 1 hop). Behind Railway every client previously shared the proxy's IP and therefore one global rate-limit bucket.
- **website:** `/api/fetch-url` is no longer an open, edge-cached proxy: HTTPS only, private/loopback/link-local/NAT64 literals refused (DNS-resolution checks are not available at the edge), no redirects, text-only, 1 MB streamed cap, browser callers must be same-origin or allow-listed, `Cache-Control: private, no-store`, upstream failures reported as 502 with the upstream status. Non-browser callers can still relay public HTTPS text through it; rate limiting belongs in Vercel's WAF. The playground no longer falls back to third-party CORS proxies (which received every URL and page body).
- New export `isBlockedAddress()` so other layers can reuse the same range checks.

### Fixed
- **core:** A hand-edited index with unsafe keys or malformed entries is rebuilt instead of making `listACOs`/`queryACOs` throw; rebuild keys entries by file name and skips files whose frontmatter id disagrees (no phantom entries). Reads (`getACO`, `getContainer`, `getCollection`) return `null` for malformed ids as in 0.1; writes still throw. `listContainers`/`listCollections` skip unparseable files. Non-JSON frontmatter values (e.g. `Date`) raise a `ValidationError` instead of a raw js-yaml error. `language` accepts `null`.
- **enrichment:** `UnifiedPipeline` follows the same empty-value rule as the single-field pipelines: empty tags/summary/entities from the model are not written and get no provenance, and an ACO that ends up unchanged is returned untouched (no `provenance: {}` write). `parseUnifiedOutput` coerces per element — one bad tag or entity costs one element, not the whole (already paid) response.
- **enrichment:** `ProviderRouter` no longer leaks one abort listener per call on a shared caller signal (uses `AbortSignal.any` where available); `OllamaProvider` clears its timeout timer after each request so processes exit promptly; OpenAI reasoning models get a floored completion budget and `reasoning_effort: "low"` so short-budget pipelines (classification, tags) return content; `fromConfig` rejects an unknown `quality` with a clear error.
- **cli:** `enrich-batch --pipelines embed` now persists the vectors (`BatchEnricher.enrichMany` returns `embeddings`; `enrichOneDetailed` added). Previously the provenance marker was written but the vector was dropped, so vector search never had data.
- **cli:** A command that failed while a spinner was running left the process hanging and erased the error. Spinners are tracked and stopped before the error is printed; commander usage errors exit 2 as documented; non-interactive `enrich`/`enrich-batch` without `--yes` now abort instead of spending.
- **cli:** `enrich-batch` budgets and reports only ACOs that actually need work (`skipped` count); `search --limit`/`--status` are validated.
- **mcp:** `enrich_aco` / `enrich_batch` skip the `embed` pipeline (with a `warning`) when the storage adapter has no `putEmbedding`, instead of running it and losing the vector while marking the ACO as embedded. Pipeline registry (`PIPELINE_NAMES`, `needsPipeline`, `buildPipeline`) now lives in `@atomic-content-protocol/enrichment` and is shared by mcp and cli.
- **server:** The token-savings message no longer claims a 0% saving with an `Infinity` break-even for content shorter than its own frontmatter; it says enrichment adds structure rather than saving tokens.
- **server:** Unmapped body-parser errors (e.g. `Content-Encoding: br`) return JSON instead of Express's HTML stack trace; failed bearer attempts are metered per IP and compared in constant time; the server refuses to start without a provider key; a provider 401/403 maps to `PROVIDER_AUTH` (not retryable); body limit accounts for 4-byte UTF-8; `TRUST_PROXY=true` logs a spoofing warning; core `ValidationError`s from `createACO` map to `INVALID_INPUT`.
- **deploy:** Railway build command is now `npm install --include=dev && npx turbo build --filter=acp-server`, which survives both failure modes seen in practice: `npm ci` cannot be used because it deletes `node_modules` and Nixpacks mounts its cache at `node_modules/.cache` (`EBUSY`), and a plain install cannot be used because Railway sets npm's `production` config, which strips TypeScript, turbo and `@types/*` so `tsc` fails with `TS7016`. `--include=dev` is the only flag that overrides that config (`--omit=` does not). A `nixpacksPlan.phases.install` override is valid per Railway's schema but had no effect, so the build command is self-sufficient. Verified by replaying the platform's exact sequence from a clean checkout under `NPM_CONFIG_PRODUCTION=true`.
- **core:** Concurrent `putACO` / `deleteACO` calls no longer corrupt `.acp/index.json`. All writes are atomic (temp file + rename) and serialised behind a per-adapter lock. A corrupt or foreign index is rebuilt automatically instead of throwing.
- **core:** `token_counts.cl100k` was actually computed with the `o200k_base` encoding (GPT-4o). It now uses `cl100k_base` as documented, and the encoder is created once per process instead of per call.
- **core:** Network errors from Node's `fetch` carry their errno on `error.cause`; the SDK read the top-level `code` and therefore marked every DNS failure as retryable. `FetchError.networkCode` and `permanent` are now populated correctly.
- **core:** `deleteACO` removes the object's embedding; `findSimilar` skips vectors whose dimensions do not match the query instead of returning `NaN` scores; `putEmbedding` rejects empty or non-finite vectors.
- **core:** ACOs without a `status` are indexed as `draft` (the spec default) so `queryACOs({ status: ["draft"] })` matches them.
- **enrichment:** Provenance recorded the router's *primary* model even when a fallback provider answered (e.g. said `claude-haiku-4-5` after falling back to OpenAI). Every pipeline now records the model that actually produced the field.
- **enrichment:** `EmbedPipeline` provenance recorded the chat model instead of the embedding model.
- **enrichment:** Claude Haiku 4.5 was priced at Claude 3 Haiku rates ($0.25 / $1.25 per MTok). Correct list price is $1.00 / $5.00, so every estimate and the README's "~$0.002 per object" were roughly 4x too low.

### Changed
- **repo:** `vitest` 3 → 5 in every workspace (closes the remaining moderate audit findings).
- **cli:** Every failure now prints one clean line and a meaningful exit code (1 runtime, 2 usage, 3 invalid ACOs, 4 no provider) instead of an unhandled-rejection stack trace; `ACP_DEBUG=1` shows the stack. Uses `parseAsync` with a top-level catch.
- **cli:** `--max-cost` is enforced *before* spending: ACOs are estimated up front, only those that fit the budget are sent to a provider, the rest are reported as deferred. Previously every ACO was enriched and the flag only stopped *saving*.
- **cli:** Vault resolution walks up from the current directory to the nearest `.acp/config.json` (like git) and every command accepts `--vault <path>`. `vault_path` in the config is relative to the config file, so vaults can be moved or committed. Config is validated (unknown keys, bad values) instead of silently falling back to defaults.
- **cli:** Prompts (author, confirmations) only run when stdin and stderr are TTYs; in CI or pipes they no longer hang.
- **cli:** `--source-type` and `--pipelines` are validated; `create` gains `--url` (guarded fetch via core) and `--json`; `validate` accepts a single `.md` file and `--json`; `enrich` and `enrich-batch` accept the `embed` pipeline (vector persisted to the vault), `--json`, and stamp the ACP §3.13 `tool` id in provenance (single `enrich` previously did not); `enrich-batch` gains `--concurrency`. `init` gains `--yes`, `--author-*`, `--force`, refuses to clobber an existing vault, and writes current model presets (no more `gpt-4o-mini`). Version is read from `package.json`.
- **cli:** README documents the real arguments (`serve` and `stats` take no positional path; `enrich` takes an id) and exit codes.
- **core:** `AuthorSchema` and `TokenCountsSchema` live once in `schema/common.schema.ts` (exported) instead of being copy-pasted into the ACO, Container and Collection schemas.
- **core:** `parseACO` / `serializeACO` share one YAML engine. Files always end with exactly one newline and `parseACO` strips exactly that one, so `parseACO(serializeACO(fm, body)).body === body` (previously bodies gained a trailing `\n` per cycle). `content_hash` is unaffected (it already trimmed).
- **core:** `ValidatedParseResult` is a discriminated union: `valid: true` narrows `frontmatter` to `ACOFrontmatter`.
- **core:** One export surface — `index.ts` re-exports `utils/index.ts` instead of hand-picking (which had drifted). Removed the unused `ACOParseResult` type and stale generation-era comments.
- **core:** `sideEffects: false` for bundlers; `@types/uuid` dropped (uuid ships types); `npm run lint` now type-checks the test files too.
- **core:** New `fetchPageForUrl()` returns text plus `title`, `ogImage`, `description`; `fetchBodyForUrl()` is a thin wrapper.
- **docs:** Core README quick start compiles (`createACO` is async, `serializeACO(frontmatter, body)`); the root README no longer claims core runs in browsers — it uses `node:fs`/`node:crypto`/`node:dns`.
- **enrichment:** Idempotency now follows the spec's authorship rule. A field that already holds a non-empty value is left alone unless `force` is set — a value without a provenance record is treated as human-authored and is never overwritten implicitly. Empty values (`""`, `[]`, missing) are (re)generated. Applies to every pipeline. Previously human-written tags/summaries without provenance were silently replaced.
- **enrichment:** When a pipeline cannot extract a usable value it now returns the ACO unchanged and writes **no** provenance record, so the next run retries. Previously tag/entity pipelines wrote `[]` plus provenance, which made the field skip forever.
- **enrichment:** `CircuitBreaker` HALF_OPEN admits exactly one probe; concurrent callers get a `CircuitOpenError` without executing. A failed probe re-opens immediately. The request timeout now aborts the underlying HTTP call via `AbortSignal` (`CircuitTimeoutError`) instead of leaving it running. `execute(fn)` passes the signal to `fn`.
- **enrichment:** `ProviderRouter` forwards the breaker signal to providers, reports bypassed providers via `onProviderSkipped`, exposes `providers` (name/model/state) and `embeddingModel`, and `embedWithMeta` returns the embedding model rather than the chat model.
- **enrichment:** `ClassificationPipeline` classifies image/video ACOs deterministically from their source type without an LLM call.
- **enrichment:** Single-field pipelines share a `SingleFieldPipeline` base class (exported) and a fence/prose-tolerant `extractJsonArray()`.
- **enrichment:** OpenAI default model is now `gpt-5.6-luna` (was the two-generations-old `gpt-4o-mini`). Anthropic default stays `claude-haiku-4-5`.
- **enrichment:** Anthropic structured output uses `output_config.format` (JSON-schema constrained decoding) instead of forced tool use, so it works uniformly across Haiku 4.5, Sonnet 5 and Opus 5. Sampling parameters are omitted for models that reject them (Claude 5 family, Claude 4.7+).
- **enrichment:** OpenAI requests use `max_completion_tokens` and omit `temperature` for reasoning models (gpt-5.x, o-series), which reject it.
- **enrichment:** Ollama structured output passes the JSON schema as `format` (constrained decoding) and every Ollama request has a 120 s timeout.
- **enrichment:** Cost estimates count only the body actually sent to the model (≈4 000 chars) instead of the whole document.
- **mcp:** Each `ACPMCPServer` owns its own `ToolRegistry` and one shared, lazily-built enrichment provider (circuit-breaker state persists across calls). The module-level `registerTool`/`getAllTools`/… functions still work but are deprecated. New public `listTools()`, `callTool()`, `toolNames`, `close()`.
- **mcp:** `EnrichmentConfig` accepts `provider` (bring your own `IEnrichmentProvider`) and `routerOptions` in addition to `providers`.
- **mcp:** `update_aco` accepts `relationships` (validated against the core edge schema) and `body` (content_hash and token_counts recomputed); `detect_relationships` now points at it correctly.
- **mcp:** `find_similar` and `detect_relationships` no longer stop at 500 ACOs; they page through the whole vault. Cosine scores are calibrated (0.5 → 0, 1.0 → 1) so unrelated documents no longer pass as "high semantic similarity"; `detect_relationships` embeds the source once and reads stored vectors instead of embedding every candidate on every call.
- **mcp:** `enrich_aco` / `enrich_batch` accept the `embed` pipeline and persist the vector via `storage.putEmbedding`, so vector search can actually return results. Skip logic mirrors the pipelines' idempotency rule (`needsPipeline`) and is identical for single and batch. `enrich_batch` gains `concurrency` and reports `skipped` / `missing`.
- **mcp:** `list_acos` applies sort order and pagination after filters (previously ignored `sortBy`/`order` whenever a filter was set) and reports `total` for filtered queries.
- **mcp:** `delete_aco` returns an error for unknown ids instead of `deleted: true`; unknown tools return a JSON-RPC method-not-found error; `$schema` is stripped from `inputSchema`; source-type enums come from core instead of hand-copied lists; server name/version default to the package's.
- **server:** Refactored into `config.ts` (validated env), `app.ts` (Express factory with injectable router), `EnrichmentService` (tool dispatch), `RateLimiter` / `SpendGuard`. Fresh MCP server/transport per request are now closed when the response ends. Tool failures set `isError: true`; unknown tools return a JSON-RPC method-not-found error; `$schema` is stripped from `inputSchema`. `express.json` limit sized for a full batch (previously 100 KB, smaller than one legal batch). Health reports version from `package.json`, provider flags, tier, auth and cap. PostHog shutdown is awaited on SIGTERM so buffered events are not lost; batch analytics record total cost, not the first item's. `ENRICHMENT_QUALITY` selects the model tier. Enrichment timeout is enforced by the router's circuit breaker (which aborts the HTTP request) instead of a race that left the call running.

### Added
- **cli:** First test suite — unit tests for config discovery/validation, budget planning and pipeline parsing, plus an end-to-end test that drives the built binary (`init` → `create` → `validate` → `search` → `stats`, error paths and exit codes).
- **core:** Tests for `serializeACO` round-trip fidelity, the shared YAML engine, `getRelatedACOs` graph traversal (depth, cycles, rel-type filter, external targets, ordering) and the shared schema fragments.
- **enrichment:** `BatchEnricher.enrichMany(acos, { concurrency })` — bounded parallelism (default 1, unchanged behaviour). Results keep input order; `errors[]` now carries the input `index`.
- **enrichment:** `completeWithModel` / `structuredCompleteWithModel` / `embedWithModel` helpers and optional `*WithMeta` provider methods.
- **enrichment:** Quality tiers. `ProviderRouter.fromConfig({ quality: "fast" | "balanced" | "best", ... })` picks default models per provider (`fast` → Claude Haiku 4.5 / GPT-5.6 Luna, `balanced` → Claude Sonnet 5 / GPT-5.6 Terra, `best` → Claude Opus 5 / GPT-5.6 Sol). Default `fast`; an explicit `model` still wins. Exposed as `MODEL_PRESETS`, `MODEL_PRICING`, `pricingFor()`.
- **enrichment:** `UnifiedOutputSchema` / `parseUnifiedOutput()` — Zod validation and normalisation of model output (tags lower-cased, de-duplicated, ≤ 20; summary ≤ 500 chars; entity types/confidence sanitised; language as ISO 639-1 or null). `UnifiedPipeline` runs every response through it before touching frontmatter.
- **enrichment:** `CompletionOptions.signal` (AbortSignal) is forwarded to every provider request; `embeddingModel` is configurable and exposed on OpenAI and Ollama providers; providers accept an injected client/fetch for testing.
- **enrichment:** `estimateEnrichmentCost(content, depth, { model | quality })` returns `cost` and `model` for the headline model and prices all six preset models in `estimatedCost`.
- **mcp:** First test suite — 14 integration tests over a temp filesystem vault with a fake provider (registry isolation, CRUD round trip incl. relationships, sort-after-filter, idempotent enrichment, embed → find_similar → detect_relationships, overlap fallbacks, batch accounting).
- **server:** First test suite (rate limiter, spend guard, config, HTTP integration against a fake provider: weights, CORS, auth, 413/400, SSRF refusals, batch errors, budget cap).

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
