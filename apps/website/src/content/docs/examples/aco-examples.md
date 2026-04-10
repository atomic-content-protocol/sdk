---
title: ACO Examples
description: Real-world examples of Atomic Content Objects — minimal, enriched, and containerized.
---

Three examples showing how ACOs look in practice: the minimum valid form, a fully enriched real-world object, and a Container grouping multiple ACOs.

---

## Example 1: Minimal ACO

The smallest valid ACO. Six required fields, no optional fields, content body present.

```yaml
---
id: "550e8400-e29b-41d4-a716-446655440000"
acp_version: "0.2"
object_type: "aco"
source_type: "manual"
created: "2026-04-10T12:00:00Z"
author:
  id: "user-001"
  name: "Kyle Hudson"
---

## Notes on ACP

ACP defines a universal format for knowledge objects. Each object is a Markdown
file with structured YAML frontmatter — readable by humans and AI alike.

Key principles:
- Six required fields. Everything else optional.
- Immutable identity and provenance fields.
- Forward-compatible: implementations must ignore unknown fields.
```

This is a valid ACO. It can be opened in any text editor, processed by any Markdown parser, and consumed by any ACP-compliant implementation.

---

## Example 2: Enriched ACO

A realistic ACO captured from a web article and enriched by AI. This is from the ACP schema spec (section 6).

```yaml
---
id: "01952f8a-3b4c-7d5e-6f07-a8b9c0d1e2f3"
acp_version: "0.2"
object_type: "aco"
source_type: "link"
created: "2026-02-23T10:30:00Z"
modified: "2026-02-23T10:31:05Z"
author:
  id: "0c56a508-4720-424e-810b-dde9d4319c88"
  name: "Kyle Hudson"

title: "Pocket Is Dead. Your Bookmarks Died With It."
language: "en"
content_hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
token_counts:
  cl100k: 1847
  claude: 1802
  approximate: 1830

tags: ["content-portability", "platform-risk", "bookmarks", "pocket"]
classification: "analysis"
key_entities:
  - type: "organization"
    name: "Mozilla"
    confidence: 0.99
  - type: "product"
    name: "Pocket"
    confidence: 0.99
  - type: "concept"
    name: "platform lock-in"
    confidence: 0.92

source_url: "https://example.com/pocket-is-dead"

summary: "Analysis of Pocket's shutdown in July 2025 and how it erased millions of users' saved content overnight. Makes the case that platform-locked content is inherently fragile and that portable, self-describing knowledge objects are the only durable alternative."
confidence: 0.88
provenance:
  summary:
    model: "gpt-4o-mini"
    version: "2024-07-18"
    timestamp: "2026-02-23T10:31:00Z"
    confidence: 0.93
  tags:
    model: "gpt-4o-mini"
    version: "2024-07-18"
    timestamp: "2026-02-23T10:31:00Z"
    confidence: 0.89
  key_entities:
    model: "gpt-4o-mini"
    version: "2024-07-18"
    timestamp: "2026-02-23T10:31:00Z"
    confidence: 0.95

relationships:
  - rel_type: "supports"
    target_id: "01952a3b-0000-0000-0000-acp-vision-001"
    confidence: 0.88
    provenance:
      model: "gpt-4o-mini"
      timestamp: "2026-02-23T10:31:00Z"

visibility: "public"
agent_accessible: true
rights: "CC-BY-4.0"
expiration: null
status: "final"
---

# Pocket Is Dead. Your Bookmarks Died With It.

In July 2025, Mozilla shut down Pocket. By November, even the export tool was gone.
Millions of users lost years of saved articles, highlights, and tags — not because
the content disappeared from the web, but because their *references* to it were
locked inside a platform that stopped existing.

This is the fundamental fragility of platform-locked content...

[Content continues]
```

### What to notice in this example

- `source_type: "link"` triggers the requirement for `source_url`.
- `content_hash` uses the `"sha256:<hex>"` format, computed on the content body only.
- `token_counts` has three tokenizer keys — useful for multi-model agents.
- `key_entities` are typed objects with confidence scores, not flat strings.
- `provenance` covers three auto-generated fields: `summary`, `tags`, `key_entities`. Each records the model, version, timestamp, and confidence.
- `confidence: 0.88` is the ACO-level behavioral signal — distinct from the per-field provenance confidence scores.
- The `relationships` edge is auto-detected (has `confidence` and `provenance`). The source ACO "supports" a target ACO with high confidence.
- `expiration: null` explicitly marks this as permanent.

---

## Example 3: Container with Three ACOs

A Container grouping three related ACOs into a curated collection.

```yaml
---
id: "01952a3b-cccc-0000-0000-000000000001"
acp_version: "0.2"
object_type: "container"
created: "2026-02-20T08:00:00Z"
modified: "2026-02-23T14:00:00Z"
author:
  id: "user-uuid-here"
  name: "Kyle Hudson"

title: "MCP Protocol Research"
summary: "A curated collection of resources on the Model Context Protocol, covering spec evolution, ecosystem mapping, security concerns, and integration patterns."
tags: ["mcp", "research", "protocols"]

objects:
  - "01952f8a-3b4c-7d5e-6f07-a8b9c0d1e2f3"
  - "01952a3b-0000-0000-0000-000000000002"
  - "01952a3b-0000-0000-0000-000000000003"

token_counts:
  cl100k: 12450
  claude: 12180
  approximate: 12300

visibility: "public"
agent_accessible: true
rights: "CC-BY-4.0"
status: "final"
---

This collection tracks the evolution of the Model Context Protocol from initial
Anthropic release through ecosystem adoption. The three items cover the original
spec, early ecosystem tooling, and security analysis from the research community.
```

### What to notice in this example

- `object_type: "container"` — not `"aco"`. Containers do not have `source_type`.
- `objects` is an ordered array of ACO IDs. The order is the curation sequence.
- `token_counts` on a Container is the **sum** of token counts across all contained ACOs.
- The Container has its own `summary`, `tags`, and `visibility` — independent of the ACOs it contains.
- The Markdown body is a curator's note about why these objects are grouped.
- Containment is by reference. Removing an ID from `objects` does not delete the ACO.
