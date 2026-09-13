# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
