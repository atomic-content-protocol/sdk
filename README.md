# Atomic Content Protocol SDK

**An open standard that makes knowledge portable and readable by both humans and AI.**

[![npm version](https://img.shields.io/npm/v/@acp/core)](https://www.npmjs.com/package/@acp/core)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/atomic-content-protocol/sdk/ci.yml)](https://github.com/atomic-content-protocol/sdk/actions)

[atomiccontentprotocol.org](https://atomiccontentprotocol.org)

---

## What is ACP?

An **Atomic Content Object (ACO)** is a Markdown file with structured YAML frontmatter. It carries everything a human or AI needs to understand, trust, and traverse a piece of knowledge: identity, provenance, tags, summary, named entities, relationships, and access controls — all in a format you can read with any text editor.

ACP is the protocol. It defines the schema and semantics. You own your files. There is no required cloud service, no proprietary runtime, and no lock-in.

```markdown
---
id: "01952a3b-4c8d-7e9f-a0b1-c2d3e4f56789"
acp_version: "0.2"
object_type: "aco"
source_type: "manual"
created: "2026-01-01T09:00:00Z"
author:
  id: "developer@example.com"
  name: "Your Name"
title: "Why ACP Exists"
tags: ["protocol", "knowledge", "open-standard"]
summary: "ACP gives knowledge objects a stable identity and structure that works for both humans and AI agents."
---

Knowledge that can't be found isn't useful.
Knowledge that can't be trusted isn't safe.
ACP solves both.
```

Six required fields. Everything else is optional and enrichable later.

---

## Quick Start

### Path 1 — Write by hand

Any `.md` file with valid ACP frontmatter is a conformant ACO. No tooling required.

```yaml
---
id: "your-uuid-here"
acp_version: "0.2"
object_type: "aco"
source_type: "manual"
created: "2026-01-01T00:00:00Z"
author:
  id: "you"
  name: "Your Name"
title: "My First ACO"
---
Your content here.
```

### Path 2 — Use the CLI

```bash
npx @acp/cli init ./my-vault
npx @acp/cli create --title "My First ACO" --body "Content here"
npx @acp/cli enrich <id>
npx @acp/cli serve
```

### Path 3 — Use as a library

```typescript
import { createACO, FilesystemAdapter } from '@acp/core';
import { ProviderRouter, UnifiedPipeline } from '@acp/enrichment';

// Create and persist an ACO
const storage = new FilesystemAdapter('./vault');
const aco = await createACO({
  title: 'My Knowledge',
  body: 'Content here...',
  source_type: 'manual',
  author: { id: 'user-1', name: 'Developer' },
});
await storage.putACO(aco);

// Enrich it with AI metadata
const router = ProviderRouter.fromConfig({
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
});
const pipeline = new UnifiedPipeline();
const { aco: enriched } = await pipeline.enrich(aco, router);
await storage.putACO(enriched);
```

---

## Packages

| Package | Version | Description |
|---|---|---|
| [`@acp/core`](packages/core) | 0.1.0 | Schema validation, parse/serialize, storage adapters |
| [`@acp/enrichment`](packages/enrichment) | 0.1.0 | LLM-powered enrichment pipelines |
| [`@acp/mcp`](packages/mcp) | 0.1.0 | MCP server for AI agent access |
| [`@acp/cli`](apps/cli) | 0.1.0 | Command-line tool |

### `@acp/core`

Zero AI dependencies. Implements the protocol itself.

```typescript
import {
  createACO,          // Build a fully-initialised ACO with generated fields
  validateACO,        // Non-throwing validation against the schema
  parseACO,           // Parse a .md file string into { frontmatter, body }
  parseAndValidateACO,// Parse + validate in one call
  serializeACO,       // Serialize back to a .md string
  FilesystemAdapter,  // Read/write ACOs from a local directory
  getRelatedACOs,     // Traverse relationship edges
  generateId,         // Generate a UUID v7
  computeContentHash, // SHA-256 of the content body
  computeTokenCounts, // Per-tokenizer token count estimates
  migrate,            // Migrate an ACO from an older acp_version
} from '@acp/core';
```

### `@acp/enrichment`

LLM enrichment pipelines. Supports Anthropic, OpenAI, and Ollama.

```typescript
import {
  ProviderRouter,         // Route completions across providers with fallback + circuit-breaker
  UnifiedPipeline,        // Tags + summary + entities + classification in one LLM call
  TagPipeline,            // Tags only
  SummaryPipeline,        // Summary only
  EntityPipeline,         // Named entity extraction
  ClassificationPipeline, // Content type classification
  EmbedPipeline,          // Embedding generation
  BatchEnricher,          // Enrich many ACOs with concurrency control
} from '@acp/enrichment';
```

### `@acp/mcp`

Exposes your ACO vault as an MCP server. AI agents can list, read, create, search, and enrich ACOs using standard MCP tool calls.

```typescript
import { ACPMCPServer } from '@acp/mcp';
import { FilesystemAdapter } from '@acp/core';

const server = new ACPMCPServer({
  storage: new FilesystemAdapter('./vault'),
  enrichment: {
    providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! } },
  },
});
await server.start();
```

### `@acp/cli`

```bash
npm install -g @acp/cli
acp --help
```

---

## Enrichment

One LLM call adds five fields to any ACO. Cost: ~$0.002 per object using claude-haiku or gpt-4o-mini. Latency: 0.8–2.2s.

**Before:**

```yaml
---
id: "01952a3b..."
acp_version: "0.2"
object_type: "aco"
source_type: "link"
created: "2026-01-15T10:00:00Z"
author: { id: "dev@example.com", name: "Developer" }
title: "Understanding RAG Architectures"
source_url: "https://example.com/rag-guide"
---
Retrieval-Augmented Generation (RAG) combines...
```

**After `acp enrich <id>`:**

```yaml
---
id: "01952a3b..."
acp_version: "0.2"
object_type: "aco"
source_type: "link"
created: "2026-01-15T10:00:00Z"
author: { id: "dev@example.com", name: "Developer" }
title: "Understanding RAG Architectures"
source_url: "https://example.com/rag-guide"
tags: ["rag", "retrieval", "llm", "vector-database", "ai-architecture"]
summary: "A technical guide to RAG architectures, covering retrieval strategies, chunking methods, and embedding models for production LLM applications."
classification: "tutorial"
language: "en"
key_entities:
  - { type: "technology", name: "RAG", confidence: 0.98 }
  - { type: "technology", name: "vector database", confidence: 0.95 }
  - { type: "concept", name: "embedding", confidence: 0.92 }
provenance:
  tags: { model: "claude-haiku-4-5", generated_at: "2026-01-15T10:00:03Z" }
  summary: { model: "claude-haiku-4-5", generated_at: "2026-01-15T10:00:03Z" }
---
Retrieval-Augmented Generation (RAG) combines...
```

The `provenance` map tracks which model generated each field, so you always know what was human-written vs. machine-generated.

---

## MCP Server

Connect your ACO vault to Claude, Cursor, or any MCP-compatible AI client.

**Start programmatically:**

```typescript
import { ACPMCPServer } from '@acp/mcp';
import { FilesystemAdapter } from '@acp/core';

const server = new ACPMCPServer({
  storage: new FilesystemAdapter('./vault'),
  enrichment: {
    providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! } },
  },
  server: { name: 'my-knowledge-vault', version: '0.1.0' },
});
await server.start(); // Listens on stdio for MCP JSON-RPC
```

**Or use the CLI:**

```bash
acp serve
```

**Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "acp": {
      "command": "npx",
      "args": ["@acp/cli", "serve"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Once connected, Claude can list, read, create, search, and enrich ACOs in your vault directly from the conversation.

---

## CLI Reference

| Command | Description |
|---|---|
| `acp init [path]` | Initialize a new ACP vault with a config file |
| `acp create` | Create a new ACO interactively or with flags |
| `acp validate [path]` | Validate all ACOs in the vault against the schema |
| `acp enrich <id>` | Enrich a single ACO with AI-generated metadata |
| `acp enrich-batch` | Enrich all ACOs in the vault |
| `acp search <query>` | Search ACOs by title, tags, summary, or body |
| `acp serve` | Start the MCP server for AI agent access |
| `acp stats` | Show vault statistics and enrichment coverage |

**`acp create` flags:**

```bash
acp create --title "My ACO" --body "Content" --source-type manual --tags "ai,protocol"
```

**`acp enrich` flags:**

```bash
acp enrich <id> --pipelines unified     # Default: all fields in one call
acp enrich <id> --pipelines tag,summary # Run specific pipelines
acp enrich <id> --force                 # Overwrite existing enrichment
acp enrich <id> --dry-run               # Preview without writing
```

**`acp search` flags:**

```bash
acp search "retrieval augmented" --tags ai --limit 10
```

---

## Architecture

Three layers. Each works independently.

```
┌─────────────────────────────────────────┐
│  @acp/mcp       MCP server              │  AI agents connect here
├─────────────────────────────────────────┤
│  @acp/enrichment  LLM pipelines         │  Add AI metadata
├─────────────────────────────────────────┤
│  @acp/core      Protocol + storage      │  Zero AI dependencies
└─────────────────────────────────────────┘
```

**`@acp/core`** is the protocol layer. It defines the schema (via Zod), handles parse/serialize, and provides a storage adapter interface. No AI dependencies. Use it anywhere — browsers, edge functions, CI pipelines.

**`@acp/enrichment`** adds LLM-powered pipelines. It depends on `@acp/core` but not on `@acp/mcp`. The `ProviderRouter` handles provider selection, fallback ordering, and circuit-breaking across Anthropic, OpenAI, and Ollama.

**`@acp/mcp`** wraps `@acp/core` and `@acp/enrichment` into an MCP server. It registers ACO operations as typed MCP tools and starts a stdio transport for JSON-RPC communication with AI clients.

This separation means you can use just `@acp/core` to build a compliant tool, add `@acp/enrichment` when you need AI metadata, and add `@acp/mcp` only when you want to expose the vault to agents.

---

## Provider Fallback & Resilience

The `ProviderRouter` automatically handles provider failures with circuit breakers:

```
Claude Haiku ($0.25/1M input)     ← primary
    ↓ circuit trips after 3 failures
GPT-4o-mini ($0.15/1M input)      ← automatic fallback  
    ↓ circuit trips after 5 failures
Ollama (local, free)               ← self-hosted fallback
```

Each provider is wrapped in a `CircuitBreaker` that:
- Tracks consecutive failures
- Trips OPEN after threshold (skips the provider entirely)
- Resets after 30 seconds (probes with one request)
- Falls back to the next provider in the chain

Configure multiple providers for resilience:

```typescript
const router = ProviderRouter.fromConfig({
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  openai: { apiKey: process.env.OPENAI_API_KEY },      // fallback
  ollama: { baseUrl: 'http://localhost:11434' },         // local fallback
});
```

If Anthropic is down, enrichment automatically falls through to OpenAI with no code changes.

---

## Token Economics

ACP enrichment creates a ~200 token frontmatter layer that agents use for triage instead of reading full documents:

| Operation | Without ACP | With ACP |
|---|---|---|
| Triage 50 documents | 250,000 tokens | 10,000 tokens (frontmatter) |
| Deep read 5 selected | — | 25,000 tokens |
| **Total** | **250,000 tokens** | **35,000 tokens (86% less)** |

Enrichment cost: ~$0.002/document. Savings compound on every subsequent read.

```typescript
import { estimateEnrichmentCost } from '@acp/enrichment';

const estimate = estimateEnrichmentCost(content, 'standard');
console.log(estimate.savingsPercent);  // 84
console.log(estimate.breakEvenReads);  // 2
```

---

## Development

**Requirements:** Node.js >= 20, npm >= 10

```bash
git clone https://github.com/atomic-content-protocol/sdk.git
cd sdk
npm install
npx turbo build
npx turbo test
```

**Run the demo:**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx examples/demo-enrich-url.ts https://example.com/some-article
```

This fetches the URL, creates an ACO, enriches it in a single LLM call, and writes the result to `./demo-vault/`. The raw `.md` file is printed at the end.

**Package structure:**

```
packages/
  core/        # @acp/core
  enrichment/  # @acp/enrichment
  mcp/         # @acp/mcp
apps/
  cli/         # @acp/cli
  website/     # atomiccontentprotocol.org
examples/
  demo-enrich-url.ts
spec/          # Protocol specification
```

---

## License

[Apache 2.0](LICENSE)

---

## Links

- Website: [atomiccontentprotocol.org](https://atomiccontentprotocol.org)
- Playground: [atomiccontentprotocol.org/playground](https://atomiccontentprotocol.org/playground)
- GitHub: [github.com/atomic-content-protocol/sdk](https://github.com/atomic-content-protocol/sdk)
- Spec: [`/spec`](spec/)
