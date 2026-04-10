---
title: Collection
description: Schema reference for the ACP Collection object — a group of Containers.
---

A **Collection** is a group of Containers. It is the highest-level organizational primitive in ACP's hierarchy.

```
Collection → Container → ACO
```

Collections are useful for organizing related Containers into a cohesive library — for example, all research on a topic, all documentation for a project, or a curated knowledge base for a team.

---

## Canonical Form

```yaml
---
id: "01952a3b-dddd-0000-0000-000000000001"
acp_version: "0.2"
object_type: "collection"
created: "2026-02-15T12:00:00Z"
modified: "2026-02-23T14:00:00Z"
author:
  id: "user-uuid-here"
  name: "Kyle Hudson"

title: "ACP Research Library"

containers:
  - "01952a3b-cccc-0000-0000-000000000001"
  - "01952a3b-cccc-0000-0000-000000000002"

total_objects: 47
token_counts:
  cl100k: 128500
  claude: 125900
  approximate: 127000

visibility: "public"
agent_accessible: true
status: "final"
---

Optional Markdown body — collection-level context or overview.
```

---

## Collection-Specific Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `containers` | array[string] | No | Ordered list of Container `id` values. |
| `total_objects` | integer | No | Count of all ACOs across all Containers. Computed value. |
| `token_counts` | object | No | Aggregate token counts across all Containers. |

**Fields that do NOT apply to Collections:** Same exclusions as Containers, plus `objects` (Collections contain Containers, not ACOs directly).

---

## Containers Array

The `containers` array stores Container IDs in display order.

```yaml
containers:
  - "01952a3b-cccc-0000-0000-000000000001"
  - "01952a3b-cccc-0000-0000-000000000002"
  - "01952a3b-cccc-0000-0000-000000000003"
```

As with Containers referencing ACOs, collection containment is by reference. A Container can be in multiple Collections.

---

## Rollup Behavior

`token_counts` on a Collection is the **sum** of `token_counts` across all Containers in the `containers` array, per tokenizer key.

`total_objects` is the sum of all ACOs across all Containers. It is a denormalized count for display and estimation purposes — it should be treated as approximate if any ACO is in multiple Containers within the same Collection.

---

## Required Fields

A Collection is valid with: `id`, `acp_version`, `object_type` (set to `"collection"`), `created`, `author`.

The `containers` array is optional. An empty Collection is valid.
