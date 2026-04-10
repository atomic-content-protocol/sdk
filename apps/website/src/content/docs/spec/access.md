---
title: Access Model
description: Three independent axes — visibility, agent_accessible, and rights — plus ephemeral deletion semantics.
---

ACP's access model uses three independent, composable axes. Each controls a different dimension of access. They do not imply each other.

---

## The Three Axes

### `visibility` — Discovery

Who can find and view the object in a user interface or search.

| Value | Meaning |
|---|---|
| `public` | Visible to anyone. Discoverable in search and listings. |
| `private` | Visible only to the owner. Not discoverable. Default. |
| `restricted` | Visible to specific users or groups defined by the implementation. |

### `agent_accessible` — Machine Access

Whether AI agents can access this object via transport protocols like MCP.

| Value | Meaning |
|---|---|
| `true` | AI agents can reach and read this object |
| `false` | AI agents cannot access this object. Default. |

This field is transport-agnostic. It does not specify MCP specifically — it controls whether agents can reach the object, regardless of which protocol they use.

### `rights` — Usage Permissions

What consumers are allowed to do with the content. Informational in ACP v0.2.

```yaml
rights: "CC-BY-4.0"
```

Recommended: SPDX license identifiers (e.g., `"CC-BY-4.0"`, `"CC0-1.0"`, `"MIT"`, `"proprietary"`). Free-text also accepted.

Rights enforcement is NOT required in v0.2 — this field signals intent. Machine-readable enforcement is a future capability.

---

## Independence of the Three Axes

The three axes are fully independent and composable. Any combination is valid:

| `visibility` | `agent_accessible` | Use case |
|---|---|---|
| `public` | `true` | Fully open — discoverable by humans and agents |
| `public` | `false` | Human-visible only — a public post you do not want crawled by agents |
| `private` | `true` | Private but agent-accessible — your own AI can read your private notes |
| `private` | `false` | Fully private — visible only to the owner, no agent access |
| `restricted` | `true` | Team-restricted but agent-accessible to team agents |

This separation matters because AI access and human access have fundamentally different risk profiles. Controlling them independently gives implementations and users precise control.

---

## Status and Expiration

Two additional access-adjacent fields:

| Field | Type | Description |
|---|---|---|
| `status` | string enum | `"draft"`, `"final"`, `"archived"`. Default: `"draft"`. |
| `expiration` | string (ISO 8601) / null | If set, the object is ephemeral. `null` or absent = permanent. |

`status` is informational — it signals the editorial state of the object. Implementations MAY use it to filter results (e.g., exclude archived objects from default search).

---

## Ephemeral Deletion Semantics

An ACO with an `expiration` field set to a future timestamp is ephemeral. When that timestamp is reached:

### Step 1: Remove from discovery

The ACO MUST be removed from all search results, listings, and agent endpoints. It must not be discoverable or reachable after expiration.

### Step 2: Delete the content body

The content body SHOULD be deleted. Implementations MAY retain the frontmatter (metadata only) for audit purposes, but MUST NOT serve the content body after expiration.

### Step 3: Remove from Container membership

References to the expired ACO in any Container's `objects` array MUST be removed. The Container itself is not affected — only the specific reference to the expired ACO.

### Step 4: Dangling relationship edges

Relationship edges pointing to the expired ACO from other ACOs become dangling references. Implementations SHOULD clean these up (remove or tombstone the edge) but are not required to do so synchronously at expiration time.

### Tombstone vs. hard delete

The protocol does not mandate a specific deletion mechanism. Implementations MAY use:

- **Tombstones:** Metadata retained, content purged. Useful for audit trails.
- **Hard deletes:** Full removal of all data.

The only protocol-level requirement is that expired objects are not discoverable, not served to agents, and removed from Container membership.

---

## v0.1 Migration

`api_readable` was removed in v0.2. It was redundant with `agent_accessible` and created ambiguity about what "API" meant.

- Use `agent_accessible` for agent access control.
- Human API access is governed by `visibility` and implementation-level authentication.

The old `mcp_connectable` field name (used in pre-v0.3 drafts) was renamed to `agent_accessible`. The rename makes the field transport-agnostic — it controls agent access regardless of whether the transport protocol is MCP, HTTP, or anything else.
