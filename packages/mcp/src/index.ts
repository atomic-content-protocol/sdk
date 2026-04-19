/**
 * @atomic-content-protocol/mcp — MCP server for the Atomic Content Protocol.
 *
 * Exposes ACO operations as tools that AI agents can call via the
 * Model Context Protocol (MCP).
 *
 * Quick start:
 *
 * ```typescript
 * import { ACPMCPServer } from '@atomic-content-protocol/mcp';
 * import { FilesystemAdapter } from '@atomic-content-protocol/core';
 *
 * const storage = new FilesystemAdapter({ vaultPath: './my-vault' });
 * const server = new ACPMCPServer({
 *   storage,
 *   enrichment: {
 *     providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! } },
 *   },
 * });
 * await server.start();
 * ```
 */

export { ACPMCPServer } from "./server.js";
export type { ACPMCPServerConfig, EnrichmentConfig } from "./server.js";

export type {
  ACPToolDefinition,
  ToolAnnotations,
  ToolOutput,
  ToolHandler,
  ToolEntry,
} from "./types/tool.js";

export {
  registerTool,
  getAllTools,
  getToolHandler,
  toolExists,
  clearRegistry,
} from "./tool-registry.js";

export { adaptToolForMCP, zodSchemaToJsonSchema } from "./tool-adapter.js";
