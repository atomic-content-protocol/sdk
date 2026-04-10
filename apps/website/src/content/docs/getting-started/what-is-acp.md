---
title: What is ACP?
description: The Atomic Content Protocol — an open standard for portable, AI-ready knowledge objects.
---

## The One-Liner

**ACP is an open standard that makes knowledge portable and readable by both humans and AI.**

Or in developer terms: ACP is a spec for portable knowledge objects — Markdown with structured YAML frontmatter — designed to be agent-accessible by default.

---

## The Problem

Think about all the knowledge you encounter in a week. Articles you read. Answers an AI gives you. PDFs someone sends. Notes you jot down. A great thread you want to remember.

Where does all of that go?

Some gets bookmarked — but bookmarks are just URLs. They break, they have no context, and AI cannot do anything with them. Some gets saved to a note app — but it is locked inside that app, unstructured, invisible to everything else. Some stays in a chat thread and disappears in a few days. Most of it just evaporates.

Meanwhile, AI tools are everywhere now. Every product has an assistant. But the number one bottleneck is not "can AI do the task?" — it is "does AI have the right context?" And right now, that context is scattered across platforms that do not talk to each other, in formats AI cannot efficiently read.

---

## What ACP Does

ACP defines a universal format for knowledge. It is called an **Atomic Content Object** — an ACO.

Imagine every piece of knowledge you save got wrapped in a capsule. Inside is the content itself — an article, a note, a conversation excerpt, a PDF converted to text. Around it is a shell of structured metadata: what it is, where it came from, when it was created, what it is about, how it relates to your other knowledge, who can access it, and whether AI agents are allowed to read it.

That capsule is self-contained. You can move it between apps. You can export it. You can drop it into an Obsidian vault and it just works — it is a valid Markdown file. You can hand it to an AI agent and the agent instantly understands its structure, not just its text.

---

## The ACO Format

An ACO is a Markdown file with YAML frontmatter. No proprietary format, no binary blobs, no special tooling required.

```yaml
---
id: "01952a3b-4c5d-7e8f-9a0b-1c2d3e4f5a6b"
acp_version: "0.2"
object_type: "aco"
source_type: "link"
created: "2026-02-23T10:30:00Z"
author:
  id: "user-uuid"
  name: "Kyle Hudson"

title: "How MCP Standardizes Agent-to-Tool Communication"
language: "en"
token_counts:
  cl100k: 2847
  claude: 2791
summary: "An overview of MCP's transport layer..."
tags: ["mcp", "ai-agents", "protocols"]

relationships:
  - rel_type: "derived-from"
    target_id: "01952a3b-0000-0000-0000-000000000001"
    confidence: 0.95

visibility: "public"
agent_accessible: true
status: "final"
---

[Markdown content body]
```

Six required fields. Everything else optional. The spec has a tiny mandatory core and a wide optional surface — use as little or as much as your implementation needs.

### What makes this different from "just Markdown with frontmatter"

**Identity and provenance.** Every ACO has a UUID, an author, a creation timestamp, and a `source_type` that records how it was created — from a URL, from a PDF upload, from selected text, from an LLM conversation. That provenance is immutable. You always know where a piece of knowledge came from.

**AI-readiness fields.** `token_counts` is an object with per-tokenizer counts (tokenizers diverge 20%+ across models). An agent can check whether an ACO fits in its context window *before* fetching the content. `agent_accessible` explicitly controls whether AI agents can access the object. `summary` gives agents a preview without loading the full body.

**Typed relationship edges.** Not a flat list of related IDs. Each relationship carries a type (`references`, `derived-from`, `supersedes`, `supports`, `contradicts`, `part-of`, `related`), a confidence score, and provenance. This is a knowledge graph built into every object.

**Per-field provenance.** Auto-generated fields (summary, tags, entities) carry provenance: which model generated them, when, at what confidence. The absence of provenance on a field signals human authorship.

**Dual confidence model.** ACO-level `confidence` is a behavioral relevance signal — how reliable this object is as a reference source, based on engagement patterns. Per-field provenance `confidence` is the generating model's self-assessed accuracy for that specific field. These measure different things.

---

## The Hierarchy

ACP defines three primitive object types:

```
Collection → Container → ACO
```

| Object | Role |
|--------|------|
| **ACO** | The knowledge object itself. One piece of content with all its metadata. |
| **Container** | An ordered group of ACOs with its own metadata, summary, and aggregate token counts. Equivalent to a curated collection or "Stack." |
| **Collection** | A group of Containers. The highest organizational level. |

Containment is by reference, not by value. One ACO can live in multiple Containers. Removing it from a Container does not delete it. There is one canonical object, many references.

---

## The Access Model

Three independent dimensions control access:

| Dimension | Values | Controls |
|-----------|--------|----------|
| `visibility` | `public`, `private`, `restricted` | Who can discover and view it in a UI |
| `agent_accessible` | `true`, `false` | Whether AI agents can access it via transport protocols like MCP |
| `rights` | license string | What consumers are allowed to do with the content |

These are independent. A private ACO can be agent-accessible (your own AI agent can read your private knowledge). A public ACO can block agent access (visible to humans, not to bots). This separation matters because AI access and human access have different risk profiles.

---

## The MCP Relationship

**MCP (Model Context Protocol) is transport. ACP is content.**

MCP standardizes how AI agents connect to data sources — the pipe. ACP standardizes what the data looks like when it arrives — the water.

Every MCP server today reinvents knowledge representation with ad hoc JSON. There is no agreement on what fields a knowledge object should have, how provenance is tracked, or how relationships between objects are expressed. ACP fills that gap. An MCP server serving ACOs gives agents a predictable, rich, self-describing payload instead of a wall of unstructured text.

The analogy: HTTP defines how web pages are requested and delivered. HTML defines what a web page looks like. MCP is our HTTP. ACP is our HTML.

---

## What ACP is NOT

- **Not a database.** It is a format and a set of rules. Implementations store ACOs however they want.
- **Not an API.** It does not define endpoints. MCP handles transport.
- **Not a product.** Stacklist is a product. ACP is the underlying open standard.
- **Not a note-taking format.** It is for any content: links, documents, LLM outputs, text selections, manually written knowledge.
- **Not an AI framework.** It does not do inference or orchestration. It defines what knowledge looks like so AI systems can consume it efficiently.

---

## Quick Distinctions

| Conflation | Correction |
|------------|------------|
| "ACP is Stacklist's format" | ACP is an open protocol. Stacklist is one implementation. Like HTTP and Chrome. |
| "An ACO is a bookmark" | A bookmark is a URL pointer. An ACO carries the content, metadata, relationships, provenance, and access rules. |
| "It is just Markdown with YAML" | Markdown + YAML is the serialization. ACP is the schema, the relationship model, the provenance system, and the access rules built on top. |
| "MCP does this already" | MCP is transport (how agents connect). ACP is content (what arrives). Complementary layers, not competitors. |
| "Portable means exportable" | Exportable means you can get data out. Portable means the object carries everything it needs to be understood anywhere — without depending on the app that created it. |
