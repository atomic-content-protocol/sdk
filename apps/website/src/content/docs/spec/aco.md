---
title: ACO (Atomic Content Object)
description: Complete field reference for the Atomic Content Object schema.
---

An **Atomic Content Object (ACO)** is the core primitive of ACP. It is a Markdown file with structured YAML frontmatter. Six required fields. Everything else optional.

## Canonical Form

```yaml
---
# Identity
id: "01952a3b-4c5d-7e8f-9a0b-1c2d3e4f5a6b"
acp_version: "0.2"
object_type: "aco"
source_type: "link"
created: "2026-02-23T10:30:00Z"
modified: "2026-02-23T14:15:00Z"
author:
  id: "user-uuid-here"
  name: "Kyle Hudson"

# Content metadata
title: "How MCP Standardizes Agent-to-Tool Communication"
language: "en"
content_hash: "sha256:a1b2c3d4e5f6..."
token_counts:
  cl100k: 2847
  claude: 2791
  approximate: 2830

# Classification
tags: ["mcp", "ai-agents", "protocols"]
classification: "reference"
key_entities:
  - type: "organization"
    name: "Anthropic"
    confidence: 0.98
  - type: "technology"
    name: "Model Context Protocol"
    confidence: 0.95

# Source provenance
source_url: "https://example.com/article/mcp-overview"
source_context: null

# Enrichment
summary: "An overview of how MCP standardizes the transport layer between AI agents and external tools."
confidence: 0.82  # Behavioral relevance signal (engagement-based), NOT model accuracy
provenance:
  summary:
    model: "claude-haiku-4-5"
    version: "20251001"
    timestamp: "2026-02-23T10:31:00Z"
    confidence: 0.91
  tags:
    model: "claude-haiku-4-5"
    version: "20251001"
    timestamp: "2026-02-23T10:31:00Z"
    confidence: 0.88

# Relationships
relationships:
  - rel_type: "derived-from"
    target_id: "01952a3b-0000-0000-0000-000000000001"
    confidence: 1.0
  - rel_type: "references"
    target_id: "01952a3b-0000-0000-0000-000000000002"

# Access
visibility: "public"
agent_accessible: true
rights: "CC-BY-4.0"
expiration: null
status: "final"
---

The Model Context Protocol (MCP) is an open standard that defines how AI agents
connect to external data sources and tools...

[Markdown content body continues here]
```

---

## 3.2 Identity Fields

| Field | Type | Required | Immutable | Description |
|---|---|---|---|---|
| `id` | string (UUID v7) | **Yes** | Yes | Globally unique identifier. UUID v7 recommended; UUID v4 accepted. |
| `acp_version` | string | **Yes** | No | Protocol version. Value: `"0.2"` for this spec. |
| `object_type` | string enum | **Yes** | Yes | Always `"aco"` for a knowledge object. |
| `source_type` | string enum | **Yes** | Yes | How this ACO was created. See §3.3. |
| `created` | string (ISO 8601) | **Yes** | Yes | Creation timestamp. UTC with timezone designator. Immutable after creation. |
| `modified` | string (ISO 8601) | No | No | Last modification timestamp. Updated on any field or content change. |
| `author` | object | **Yes** | Yes | Identity that created this object. See §3.4. |

**Notes:**
- `id`: UUID v7 is preferred — it encodes creation time for sort-by-creation without parsing the `created` field. UUID v4 is accepted for interoperability.
- `created`: MUST include timezone designator. `2026-02-23T10:30:00Z` is valid. `2026-02-23T10:30:00` is not.
- `object_type: "card"` from v0.1 is no longer valid. Migrate to `object_type: "aco"`.

---

## 3.3 Source Types

The `source_type` enum records how the ACO was created. Set at creation, immutable.

| Value | Origin | Required companion fields |
|---|---|---|
| `link` | URL submitted by user | `source_url` |
| `uploaded_md` | Markdown file upload | — |
| `manual` | User typed directly in-app | — |
| `converted_pdf` | PDF upload, converted to Markdown | `source_file` |
| `converted_doc` | DOCX/other document upload, converted | `source_file` |
| `converted_video` | Video upload, transcript extracted | `media` |
| `selected_text` | Highlighted text from any source | `source_url` (recommended), `source_context` |
| `llm_capture` | Saved from LLM conversation | `source_context` |

`manual` and `uploaded_md` are separate values. Both map to user-authored content at the product layer, but preserve distinct provenance: `manual` = typed in-app, `uploaded_md` = uploaded as a Markdown file.

---

## 3.4 Author

The `author` object records who created the ACO. Set at creation, immutable.

```yaml
author:
  id: "user-uuid"
  name: "Display Name"
```

| Subfield | Type | Required | Description |
|---|---|---|---|
| `id` | string | **Yes** | Unique identifier for the author. Format is implementation-specific. |
| `name` | string | **Yes** | Human-readable display name. |

Additional subfields (e.g., `url`, `public_key`) are permitted and will be preserved by compliant implementations.

---

## 3.5 Content Metadata

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | No | Human-readable title. Max 500 characters recommended. |
| `language` | string (ISO 639-1) | No | Primary language of the content body. Two-letter code: `"en"`, `"de"`, `"ja"`, etc. |
| `content_hash` | string | No | SHA-256 hash of the content body. Format: `"sha256:<hex>"`. |
| `token_counts` | object | No | Per-tokenizer token counts. See §3.6. |

**`content_hash` rules:**
- Computed on the raw content body only (after the closing `---`). Frontmatter is excluded.
- Leading and trailing whitespace in the content body is trimmed before hashing.
- Implementations MUST use SHA-256. No other algorithms.
- If an ACO's content body is modified, `content_hash` MUST be recomputed.

---

## 3.6 Token Counts

`token_counts` maps tokenizer identifiers to integer counts.

```yaml
token_counts:
  cl100k: 2847       # OpenAI GPT-4/4o tokenizer
  claude: 2791       # Anthropic Claude tokenizer
  llama3: 2912       # Meta Llama 3/4 tokenizer
  approximate: 2830  # Heuristic estimate (chars/4)
```

| Key | Description |
|---|---|
| `cl100k` | OpenAI cl100k_base tokenizer (GPT-4, GPT-4o) |
| `claude` | Anthropic Claude tokenizer (via SDK `count_tokens()`) |
| `llama3` | Meta Llama 3/4 tokenizer (via HuggingFace AutoTokenizer) |
| `approximate` | Heuristic estimate. For display when specific tokenizers are unavailable. |

**Rules:**
- Implementations are NOT required to populate all tokenizers. Populate what you can compute.
- `approximate` SHOULD always be provided as a fallback.
- Token counts are computed on the content body only. Frontmatter is excluded.
- Additional tokenizer keys are permitted and MUST be preserved.
- Token counts SHOULD be recomputed when content body changes.

**Why an object, not an integer:** Tokenizer outputs diverge 20%+ across models. A single integer is misleading. Agents need accurate counts for their specific model to make context-window decisions.

---

## 3.7 Classification

| Field | Type | Required | Description |
|---|---|---|---|
| `tags` | array[string] | No | Classification tags. Lowercase recommended. No maximum count; cap at 20 for display. |
| `classification` | string | No | Content type. Suggested values: `"reference"`, `"framework"`, `"memo"`, `"checklist"`, `"notes"`, `"transcript"`, `"snippet"`, `"code"`, `"tutorial"`, `"analysis"`, `"other"`. |
| `key_entities` | array[object] | No | Extracted named entities. See §3.8. |

`classification` is not an enum. The suggested values are recommendations. Implementations MAY define additional values.

---

## 3.8 Key Entities

`key_entities` is an array of structured entity objects.

```yaml
key_entities:
  - type: "person"
    name: "Tim Berners-Lee"
    confidence: 0.97
  - type: "organization"
    name: "Linux Foundation"
    confidence: 0.99
  - type: "concept"
    name: "knowledge graphs"
    confidence: 0.85
```

| Subfield | Type | Required | Description |
|---|---|---|---|
| `type` | string | **Yes** | Entity type. Suggested: `"person"`, `"organization"`, `"technology"`, `"concept"`, `"location"`, `"event"`. Open set. |
| `name` | string | **Yes** | Entity name. Canonical reference form. |
| `confidence` | float 0.0–1.0 | No | Model confidence for auto-extracted entities. Omit for human-asserted. |

**Entity-level confidence provenance:** Entity confidence values inherit their model identity from the `provenance.key_entities` record. Per-entity provenance is not carried individually — the batch provenance record covers all entities in the array.

**v0.1 migration:** `key_entities` was a flat string array. Now a structured array with type and confidence. Flat string arrays are accepted for backward compatibility but SHOULD be migrated.

---

## 3.9 Source Provenance

| Field | Type | Required | Description |
|---|---|---|---|
| `source_url` | string (URL) | Conditional | Original URL. Required when `source_type: "link"`. Recommended for `selected_text`. |
| `source_file` | string | Conditional | Original filename. Required when `source_type: "converted_pdf"` or `"converted_doc"`. |
| `source_context` | object | Conditional | LLM session provenance. Required when `source_type: "llm_capture"`. See §3.10. |

---

## 3.10 Source Context (LLM Provenance)

For ACOs captured from LLM conversations.

```yaml
source_context:
  model: "claude-sonnet-4-6"
  thread_id: "thread-abc-123"
  session_id: "session-xyz-789"
  timestamp: "2026-02-23T09:15:00Z"
  platform: "claude.ai"
```

| Subfield | Type | Required | Description |
|---|---|---|---|
| `model` | string | **Yes** | Model identifier that generated the content. |
| `thread_id` | string | No | Conversation thread identifier on the source platform. |
| `session_id` | string | No | Session identifier, if different from thread. |
| `timestamp` | string (ISO 8601) | No | When the content was generated in the conversation. |
| `platform` | string | No | Source platform: `"claude.ai"`, `"chatgpt"`, `"cursor"`, etc. |

Additional subfields are permitted and preserved.

---

## 3.11 Media

The `media` object references hosted non-text content. This field is orthogonal to `source_type` — it can appear on any ACO regardless of how the ACO was created.

```yaml
media:
  url: "https://cdn.example.com/media/video.mp4"
  mime_type: "video/mp4"
  size: 152400000
  duration: 847
```

| Subfield | Type | Required | Description |
|---|---|---|---|
| `url` | string (URL) | **Yes** | URL of the hosted media file. |
| `mime_type` | string | **Yes** | MIME type: `"video/mp4"`, `"image/png"`, `"audio/mpeg"`, etc. |
| `size` | integer | No | File size in bytes. |
| `duration` | integer | No | Duration in seconds. Applicable to video and audio. |

**Rules:**
- `media` is optional on all ACOs regardless of `source_type`.
- When `source_type: "converted_video"`, `media` is required.
- `content_hash` hashes the text content body only, not the media file.
- `token_counts` applies to the text content body only.
- Additional subfields (e.g., `thumbnail_url`, `resolution`) are permitted.

---

## 3.12 Enrichment

| Field | Type | Required | Description |
|---|---|---|---|
| `summary` | string | No | Concise summary of the content body. Max 500 characters recommended. |
| `confidence` | float 0.0–1.0 | No | Behavioral relevance signal. See below. |
| `provenance` | object | No | Per-field provenance for auto-generated fields. See §3.13. |

**`confidence` semantics:** A float from 0.0 to 1.0 representing the assessed reliability of this object as a reference source, computed from engagement signals (saves, shares, comments, recency, collection membership). This is a **behavioral relevance signal** — "how confident should a consumer be that this object is a valuable reference source?" — NOT a model accuracy score.

| Confidence type | What it measures | Who sets it |
|---|---|---|
| ACO-level `confidence` | Behavioral relevance — how useful this object has proven to be | Implementation (engagement-based) |
| Per-field provenance `confidence` | Model accuracy — how confident the model was in its output | Generating model, at enrichment time |

**Non-normative guidance:** Surface enrichments with per-field provenance confidence below 0.7 for human review. Implementations MAY define minimum thresholds below which auto-generated fields are not displayed.

---

## 3.13 Per-Field Provenance

The `provenance` object records which model generated each auto-generated field.

```yaml
provenance:
  summary:
    model: "claude-haiku-4-5"
    version: "20251001"
    timestamp: "2026-02-23T10:31:00Z"
    confidence: 0.91
  tags:
    model: "claude-haiku-4-5"
    version: "20251001"
    timestamp: "2026-02-23T10:31:00Z"
    confidence: 0.88
  key_entities:
    model: "claude-haiku-4-5"
    version: "20251001"
    timestamp: "2026-02-23T10:31:00Z"
    confidence: 0.95
```

Each key in `provenance` corresponds to a field name on the ACO. Each value is a provenance record:

| Subfield | Type | Required | Description |
|---|---|---|---|
| `model` | string | **Yes** | Model identifier used for generation. |
| `version` | string | No | Model version or checkpoint. |
| `timestamp` | string (ISO 8601) | **Yes** | When the field was generated. |
| `confidence` | float 0.0–1.0 | No | Model's confidence in the generated value. |

**Rules:**
- A field with a `provenance` entry is machine-generated. A field without one is human-authored.
- If a human edits a machine-generated field, the `provenance` entry SHOULD be removed.
- The `provenance` object only covers fields on the same ACO.

---

## 3.14 Relationships

`relationships` is an array of typed edge objects.

```yaml
relationships:
  - rel_type: "derived-from"
    target_id: "01952a3b-0000-0000-0000-000000000001"
    confidence: 0.95
    provenance:
      model: "claude-haiku-4-5"
      timestamp: "2026-02-23T10:31:00Z"
  - rel_type: "references"
    target_id: "01952a3b-0000-0000-0000-000000000002"
```

| Subfield | Type | Required | Description |
|---|---|---|---|
| `rel_type` | string | **Yes** | Relationship type. See types below. |
| `target_id` | string | **Yes** | ID of the related object. UUID for ACP objects; URL for external references. |
| `confidence` | float 0.0–1.0 | No | Confidence score. Omit for human-asserted relationships. |
| `provenance` | object | No | Which model/process created this edge. Same structure as §3.13 records. |

**Core relationship types:**

| Type | Meaning |
|---|---|
| `references` | This ACO cites or links to the target |
| `derived-from` | This ACO was created from or inspired by the target |
| `supersedes` | This ACO replaces the target |
| `supports` | This ACO provides evidence for the target's claims |
| `contradicts` | This ACO disputes the target's claims |
| `part-of` | This ACO is a component of the target |
| `related` | General association when no specific type applies |

Extension types use the `x-` prefix (e.g., `x-annotates`, `x-translates`).

**All stored edges are outbound** (this object → target). Implementations MAY compute inbound views at query time but MUST NOT store inbound edges on the target object. This eliminates referential integrity problems when the source object is deleted.

**v0.1 migration:**
- `related_objects: ["id1"]` → `relationships: [{rel_type: "related", target_id: "id1"}]`
- `derived_from: "id1"` → `relationships: [{rel_type: "derived-from", target_id: "id1"}]`
- `supersedes: "id1"` → `relationships: [{rel_type: "supersedes", target_id: "id1"}]`

---

## 3.15 Access

| Field | Type | Required | Description |
|---|---|---|---|
| `visibility` | string enum | No | `"public"`, `"private"`, `"restricted"`. Default: `"private"`. |
| `agent_accessible` | boolean | No | Whether AI agents can access this object. Default: `false`. |
| `rights` | string | No | License or rights identifier. SPDX identifiers recommended (e.g., `"CC-BY-4.0"`, `"CC0-1.0"`, `"proprietary"`). |
| `expiration` | string (ISO 8601) / null | No | If set, the object is ephemeral. `null` or absent = permanent. |
| `status` | string enum | No | `"draft"`, `"final"`, `"archived"`. Default: `"draft"`. |

`visibility`, `agent_accessible`, and `rights` are three independent, composable axes:
- **`visibility`** — who can FIND the object (humans, in UI and search)
- **`agent_accessible`** — can MACHINES reach the object via agent transport protocols
- **`rights`** — what consumers are allowed to DO with the content

A private object can be agent-accessible. A public object can block agent access. See [Access Model](/spec/access/) for full semantics.

---

## 3.16 Ephemeral Deletion Semantics

When an ephemeral ACO's `expiration` timestamp is reached:

1. The ACO MUST be removed from search results and agent endpoints.
2. The content body SHOULD be deleted. Implementations MAY retain frontmatter for audit purposes, but MUST NOT serve the content body after expiration.
3. References to the ACO in Container `objects` arrays MUST be removed.
4. Relationship edges pointing to the expired ACO become dangling references. Implementations SHOULD clean these up but are not required to do so synchronously.

The protocol does not mandate tombstones vs. hard deletes. The only requirement is that expired objects are not discoverable and not served to agents.

---

## Validation Rules

### Required fields

An ACO is valid if and only if it has: `id`, `acp_version`, `object_type`, `source_type`, `created`, `author`.

### Immutable fields

These fields MUST NOT change after creation: `id`, `object_type`, `source_type`, `created`, `author`.

### Conditional requirements

| Condition | Required |
|---|---|
| `source_type: "link"` | `source_url` |
| `source_type: "converted_pdf"` or `"converted_doc"` | `source_file` |
| `source_type: "converted_video"` | `media` (with at least `url` and `mime_type`) |
| `source_type: "llm_capture"` | `source_context` (with at least `model`) |
| `content_hash` present | Must be `"sha256:<hex>"` format, must match actual content body hash |

### Forward compatibility

Implementations MUST ignore fields they do not recognize. This allows future schema versions to add fields without breaking existing parsers.
