---
title: Connect
description: Connect the ACP enrichment server to Claude Desktop, Cursor, or any MCP-compatible agent — free, no API key, no setup.
---

A hosted ACP enrichment server is live at `mcp.atomiccontentprotocol.org`. Point any MCP-compatible client at it — **no install, no API key, no setup**. We cover the LLM costs.

---

## Claude Desktop

### Option 1 — Custom connector (recommended)

**Settings → Connectors → *Add custom connector***

- **Name:** `ACP`
- **URL:** `https://mcp.atomiccontentprotocol.org/mcp`

Save, and the enrichment tools are available in any chat.

### Option 2 — Config file

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "acp": {
      "url": "https://mcp.atomiccontentprotocol.org/mcp"
    }
  }
}
```

Fully quit and relaunch Claude. The tools appear in the tools menu.

---

## Cursor & other MCP clients

Any MCP-compatible host works. Point it at:

```
https://mcp.atomiccontentprotocol.org/mcp
```

---

## Available tools

### `enrich_url`

Fetch and enrich a URL in one call.

> **You:** Enrich this URL for me: `https://zarijak.xyz/`

Returns an ACO with title, summary, tags, key entities, classification, language, and token counts.

### `enrich_content`

Enrich raw text — for content you don't want fetched from a URL.

> **You:** Enrich this paragraph: *"The Principality of Zarijak is a self-proclaimed micronation…"*

### `enrich_batch`

Process up to 10 URLs or content blocks in a single call.

> **You:** Enrich all 9 URLs from my reading list.

Each tool accepts a `depth` option (`basic`, `standard`, `deep`) and returns a token-savings breakdown.

---

## What you get back

Every enrichment produces structured metadata an agent can read without loading the full text:

```yaml
title: "Principality of Zarijak"
summary: "A self-proclaimed micronation with territories across the Croatian coastline, offering accommodations, cultural events, and citizenship."
tags: [micronation, croatia, tourism, citizenship, coastal-territories]
classification: reference
language: en
key_entities:
  - { type: org,   name: "Principality of Zarijak" }
  - { type: place, name: "Croatia" }
  - { type: place, name: "Korčula" }
token_counts:
  content_tokens: 474
  frontmatter_tokens: 200
  savings_percent: 58
```

---

## Rate limits

- **50 enrichments/hour per IP** — free, no API key required.
- Resets hourly.
- For higher limits, private content, or self-hosting, install [`@atomic-content-protocol/mcp`](https://www.npmjs.com/package/@atomic-content-protocol/mcp) and bring your own Anthropic key.

---

## Example conversation

```
You: Enrich this URL for me: https://zarijak.xyz/

Claude calls enrich_url →

Summary: A self-proclaimed micronation with territories across
the Croatian coastline, offering accommodations, cultural events,
and citizenship across Zagreb, Rijeka, Jablanac, Korčula, and Krk.

Classification: reference · Language: en
Tags: micronation, croatia, tourism, citizenship, coastal-territories

Stats: 474 content tokens → 200 frontmatter tokens (58% savings).
Cost: ~$0.0005 via claude-haiku-4-5.
```

---

## Token savings

Measured on a real 9-URL collection of MCP server documentation:

| Approach | Tokens to triage all 9 | Cost (Opus input) |
|---|---|---|
| Raw pages | 11,250 | ~$0.17 |
| ACP frontmatter | 1,800 | ~$0.027 |
| **Savings** | **84% fewer** | **~6× cheaper** |

**Break-even: after the first read.** The one-time enrichment cost (~$0.007 for 9 items) pays itself back the moment an agent triages the collection once. Every future read is pure upside.

See the [full benchmark](/benchmark/) for methodology and per-model numbers.

---

## Troubleshooting

- **Tools not appearing in Claude Desktop** — fully quit (⌘Q) and relaunch after editing config; a reload isn't enough.
- **Connection refused** — confirm the URL ends in `/mcp` exactly: `https://mcp.atomiccontentprotocol.org/mcp`.
- **Rate limited** — wait an hour, or [self-host](https://www.npmjs.com/package/@atomic-content-protocol/mcp) for unlimited throughput.

---

## Next steps

- [Quick Start](/getting-started/quickstart/) — create your first ACO
- [Benchmark](/benchmark/) — full token-savings math
- [`@atomic-content-protocol/mcp`](https://www.npmjs.com/package/@atomic-content-protocol/mcp) — self-host with your own API key
