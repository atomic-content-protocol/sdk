---
title: Container
description: Schema reference for the ACP Container object — an ordered group of ACOs.
---

A **Container** is an ordered group of ACOs with its own metadata, summary, and aggregate token counts. It is the mid-level organizational primitive in ACP's two-level hierarchy.

In Stacklist, a Container maps to a "Stack" — a curated collection of knowledge objects.

---

## Canonical Form

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
  - "01952a3b-4c5d-7e8f-9a0b-1c2d3e4f5a6b"
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

Optional Markdown body for the Container itself — an introduction,
curator's note, or context for why these objects are grouped together.
```

---

## Container-Specific Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `objects` | array[string] | No | Ordered list of ACO `id` values. Order is meaningful — it represents the curation sequence. |
| `summary` | string | No | Synthesized summary of the contained ACOs. May be auto-generated or human-written. |
| `token_counts` | object | No | Aggregate token counts across all contained ACOs. Same format as ACO `token_counts`. |

**All identity, classification, access, and relationship fields from the ACO schema also apply to Containers.** A Container is an ACP object. It can have tags, relationships, provenance, etc.

**Fields that do NOT apply to Containers:** `source_type`, `source_url`, `source_file`, `source_context`, `content_hash`, `key_entities`, `classification`, `confidence`, `media`. These are ACO-specific.

---

## Rollup Behavior

`token_counts` on a Container is the **sum** of `token_counts` across all objects in the `objects` array, per tokenizer key.

- If any contained ACO lacks a particular tokenizer key, that key's rollup is marked `approximate` or omitted.
- Rollups are computed values. Implementations MAY cache them but MUST recompute if a contained ACO's content changes.

```yaml
# Example: Container with 3 ACOs
# ACO 1: cl100k: 1200, claude: 1180
# ACO 2: cl100k: 800, claude: 790
# ACO 3: cl100k: 2100, claude: 2050
# Result:
token_counts:
  cl100k: 4100   # 1200 + 800 + 2100
  claude: 4020   # 1180 + 790 + 2050
```

---

## Objects Array

The `objects` array stores ACO IDs in the order they should be presented. This order is meaningful — it represents the curator's intended sequence for the collection.

```yaml
objects:
  - "01952a3b-4c5d-7e8f-9a0b-1c2d3e4f5a6b"  # First item
  - "01952a3b-0000-0000-0000-000000000002"    # Second item
  - "01952a3b-0000-0000-0000-000000000003"    # Third item
```

**Containment is by reference.** One ACO can live in multiple Containers. Removing an ACO from a Container's `objects` array does not delete the ACO — it removes the reference. The canonical ACO object exists independently.

---

## Required Fields

A Container is valid with: `id`, `acp_version`, `object_type` (set to `"container"`), `created`, `author`.

The `objects` array and `summary` are optional. An empty Container (no `objects`) is valid.

---

## Content Body

A Container MAY have a Markdown content body — an introduction, curator's note, or context for why these objects are grouped together. This is optional and distinct from the `summary` field (which is a concise synthesized overview of the contained ACOs).
