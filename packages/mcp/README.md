# @atomic-content-protocol/mcp

MCP server for the [Atomic Content Protocol](https://atomiccontentprotocol.org) — exposes ACO operations as tools that AI agents can call via the [Model Context Protocol](https://modelcontextprotocol.io).

## Try it free — hosted server

A hosted MCP server is live at [`mcp.atomiccontentprotocol.org`](https://mcp.atomiccontentprotocol.org/mcp). Use it as a **custom connector** in Claude Desktop, Cursor, or any MCP-compatible client — **on us**. No install, no API keys, no setup. We cover the LLM costs.

### Add to Claude Desktop

Settings → Connectors → *Add custom connector*

- **Name:** `ACP`
- **URL:** `https://mcp.atomiccontentprotocol.org/mcp`

The `enrich_url`, `enrich_content`, and `enrich_batch` tools are immediately available in any chat.

Rate-limited to 50 enrichments/hour per IP. For higher limits, private data, or self-hosting, use the package below and bring your own key.

## Self-host

```bash
npm install @atomic-content-protocol/mcp @atomic-content-protocol/core
```

```typescript
import { ACPMCPServer } from "@atomic-content-protocol/mcp";
import { FilesystemAdapter } from "@atomic-content-protocol/core";

const storage = new FilesystemAdapter({ vaultPath: "./my-vault" });

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

## Exports

- `ACPMCPServer` — server class
- `registerTool`, `getAllTools`, `getToolHandler` — tool registry API
- `adaptToolForMCP`, `zodSchemaToJsonSchema` — adapter helpers

## Links

- Protocol spec: [atomiccontentprotocol.org](https://atomiccontentprotocol.org)
- Repository: [github.com/atomic-content-protocol/sdk](https://github.com/atomic-content-protocol/sdk)

## Stewardship

The Atomic Content Protocol is an open standard stewarded by [Stacks, Inc](https://www.stacks.inc/) — the company behind [Stacklist](https://stacklist.com).

## License

Apache-2.0
