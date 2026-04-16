# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-16

### Added

#### @acp/core
- Zod schemas for ACO, Container, and Collection (ported from ACP spec v0.4)
- Parse/serialize with gray-matter + js-yaml JSON_SCHEMA for lossless round-trips
- FilesystemAdapter with `.acp/index.json` cache and vector embedding storage
- Graph traversal for relationship edges (BFS with depth control)
- `createACO()`, `validateACO()`, `migrate()` convenience functions
- UUID v7 generation, SHA-256 content hashing with `normalizeBody()`
- Approximate and cl100k (tiktoken) token counting
- 130 unit tests

#### @acp/enrichment
- Three LLM providers: Anthropic, OpenAI, Ollama (local)
- ProviderRouter with CircuitBreaker fallback chain
- Six enrichment pipelines: Tag, Summary, Entity, Classification, Unified (single-call), Embed
- BatchEnricher with series processing and progress callbacks
- Cost estimation with `estimateEnrichmentCost()`
- Idempotency: skip fields with existing provenance unless force=true
- 52 unit tests

#### @acp/mcp
- 15 MCP tools: CRUD (5), Containers (3), Enrichment (3), Search (2), Vault (2)
- ACPMCPServer class with StdIO transport
- Tool handler pattern with Zod validation

#### @acp/cli
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
