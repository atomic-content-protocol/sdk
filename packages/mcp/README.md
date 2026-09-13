# @atomic-content-protocol/mcp

MCP server for the [Atomic Content Protocol](https://atomiccontentprotocol.org) — exposes ACO operations as tools that AI agents can call via the [Model Context Protocol](https://modelcontextprotocol.io).

## Try it free — hosted server

A hosted MCP server is live at [`mcp.atomiccontentprotocol.org`](https://mcp.atomiccontentprotocol.org/mcp). Use it as a **custom connector** in Claude Desktop, Cursor, or any MCP-compatible client — **on us**. No install, no API keys, no setup. We cover the LLM costs.

### Add to Claude Desktop

Settings → Connectors → *Add custom connector*

- **Name:** `ACP`
- **URL:** `https://mcp.atomiccontentprotocol.org/mcp`

The `enrich_url`, `enrich_content`, and `enrich_batch` tools are immediately available in any chat.

Rate-limited to 50 enrichments/hour per client (a batch of N counts as N). For higher limits, private data, or self-hosting, use the package below and bring your own key.

## Self-host

```bash
npm install @atomic-content-protocol/mcp @atomic-content-protocol/core
```

```typescript
import { ACPMCPServer } from "@atomic-content-protocol/mcp";
import { FilesystemAdapter } from "@atomic-content-protocol/core";

const storage = new FilesystemAdapter("./my-vault");

const server = new ACPMCPServer({
  storage,
  enrichment: {
    providers: {
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
    },
  },
});

await server.start();
```

## Tools

| Tool | Purpose |
|---|---|
| `create_aco`, `read_aco`, `update_aco`, `delete_aco`, `list_acos` | CRUD over the vault. `update_aco` accepts `relationships` and `body`. |
| `create_container`, `read_container`, `list_containers` | Group ACOs. |
| `enrich_aco`, `enrich_batch` | Run pipelines (`unified`, `tag`, `summary`, `entity`, `classification`, `embed`). Existing values are kept unless `force`. `embed` stores a vector for search. |
| `search_acos`, `find_similar` | Full-text search; vector similarity over stored embeddings with overlap fallback. |
| `detect_relationships` | Suggest edges from overlap + stored embeddings; apply with `update_aco`. |
| `validate_vault`, `export_aco` | Schema validation report; Markdown/JSON export. |

## Exports

- `ACPMCPServer` — server class (`listTools()`, `callTool()`, `start()`, `close()`)
- `ToolRegistry` — per-instance registry (the module-level `registerTool` family is deprecated)
- `adaptToolForMCP`, `zodSchemaToJsonSchema` — adapter helpers
- `PIPELINE_NAMES`, `needsPipeline`, `runPipelines` — enrichment helpers

## Links

- Protocol spec: [atomiccontentprotocol.org](https://atomiccontentprotocol.org)
- Repository: [github.com/atomic-content-protocol/sdk](https://github.com/atomic-content-protocol/sdk)

## Stewardship

The Atomic Content Protocol is an open standard stewarded by [Stacks, Inc](https://www.stacks.inc/) — the company behind [Stacklist](https://stacklist.com).

## License

Apache-2.0
