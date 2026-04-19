# @atomic-content-protocol/mcp

MCP server for the [Atomic Content Protocol](https://atomiccontentprotocol.org) — exposes ACO operations as tools that AI agents can call via the [Model Context Protocol](https://modelcontextprotocol.io).

## Install

```bash
npm install @atomic-content-protocol/mcp @atomic-content-protocol/core
```

## Quick start

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

## Hosted server

A hosted MCP server is available at [`mcp.atomiccontentprotocol.org`](https://mcp.atomiccontentprotocol.org/mcp) — no install needed. Point any MCP-compatible client (Claude Desktop, Cursor, etc.) at it.

## Exports

- `ACPMCPServer` — server class
- `registerTool`, `getAllTools`, `getToolHandler` — tool registry API
- `adaptToolForMCP`, `zodSchemaToJsonSchema` — adapter helpers

## Links

- Protocol spec: [atomiccontentprotocol.org](https://atomiccontentprotocol.org)
- Repository: [github.com/atomic-content-protocol/sdk](https://github.com/atomic-content-protocol/sdk)

## License

Apache-2.0
