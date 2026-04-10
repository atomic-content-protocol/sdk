---
title: Relationships
description: Typed relationship edges between ACOs — the knowledge graph built into every object.
---

ACP's relationship model builds a knowledge graph into every ACO. Rather than flat "related IDs," each relationship edge carries a type, optional confidence score, and optional provenance.

---

## The `relationships` Field

`relationships` is an array of typed edge objects on an ACO.

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
  - rel_type: "supersedes"
    target_id: "01952a3b-0000-0000-0000-000000000003"
    confidence: 1.0
```

| Subfield | Type | Required | Description |
|---|---|---|---|
| `rel_type` | string | **Yes** | Relationship type. See core types below. |
| `target_id` | string | **Yes** | ID of the related object. UUID for ACP objects; URL for external references. |
| `confidence` | float 0.0–1.0 | No | Confidence score for auto-detected relationships. Omit for human-asserted. |
| `provenance` | object | No | Which model/process created this edge. Same structure as per-field provenance records. |

---

## Core Relationship Types

| Type | Meaning | Example |
|---|---|---|
| `references` | This ACO cites or links to the target | An article that links to a paper it draws from |
| `derived-from` | This ACO was created from or inspired by the target | A summary ACO derived from a longer source ACO |
| `supersedes` | This ACO replaces the target | An updated version that obsoletes the previous one |
| `supports` | This ACO provides evidence for the target's claims | Research findings that support a thesis ACO |
| `contradicts` | This ACO disputes the target's claims | A rebuttal or counter-analysis |
| `part-of` | This ACO is a component of the target | A chapter that is part of a larger document ACO |
| `related` | General association | When no specific type applies |

---

## Extension Types

Custom relationship types use the `x-` prefix:

```yaml
relationships:
  - rel_type: "x-annotates"
    target_id: "01952a3b-0000-0000-0000-000000000001"
  - rel_type: "x-translates"
    target_id: "01952a3b-0000-0000-0000-000000000002"
```

Extension types are implementation-defined. They MUST be preserved by compliant implementations even if unrecognized.

---

## Outbound-Only Storage

**All stored edges are outbound** — they represent "this object → target."

Implementations MAY compute inbound views (which objects reference this ACO) at query time, but MUST NOT store inbound edges on the target object.

**Why:** Outbound-only storage eliminates referential integrity problems. If the source ACO is deleted, no stale inbound edges remain on any other object. If the target ACO is deleted, the edge on the source becomes a dangling reference — which is acceptable and expected behavior.

---

## Human-Asserted vs. Auto-Detected

**Human-asserted relationships:** Omit `confidence` and `provenance`. These are definitive.

```yaml
relationships:
  - rel_type: "supersedes"
    target_id: "01952a3b-0000-0000-0000-000000000001"
```

**Auto-detected relationships:** Include `confidence` and `provenance`. These reflect the generating model's certainty.

```yaml
relationships:
  - rel_type: "supports"
    target_id: "01952a3b-0000-0000-0000-000000000002"
    confidence: 0.78
    provenance:
      model: "claude-haiku-4-5"
      timestamp: "2026-02-23T10:31:00Z"
```

---

## External References

`target_id` can be a URL for external references (content that is not an ACP object):

```yaml
relationships:
  - rel_type: "references"
    target_id: "https://modelcontextprotocol.io/specification"
```

This enables ACOs to express relationships to any content on the web, not just other ACOs.

---

## v0.1 Migration

v0.1 had separate top-level fields for common relationship types. All relationship information is now consolidated in the `relationships` array.

| v0.1 | v0.2 equivalent |
|---|---|
| `related_objects: ["id1", "id2"]` | `relationships: [{rel_type: "related", target_id: "id1"}, {rel_type: "related", target_id: "id2"}]` |
| `derived_from: "id1"` | `relationships: [{rel_type: "derived-from", target_id: "id1"}]` |
| `supersedes: "id1"` | `relationships: [{rel_type: "supersedes", target_id: "id1"}]` |
