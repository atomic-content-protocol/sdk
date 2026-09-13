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
 * const storage = new FilesystemAdapter('./my-vault');
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

export type { ToolContext } from "./context.js";
export { EnrichmentNotConfiguredError } from "./context.js";

export type {
  ACPToolDefinition,
  ToolAnnotations,
  ToolOutput,
  ToolHandler,
  ToolEntry,
} from "./types/tool.js";

export {
  ToolRegistry,
  registerTool,
  getAllTools,
  getToolHandler,
  toolExists,
  clearRegistry,
} from "./tool-registry.js";

export { adaptToolForMCP, zodSchemaToJsonSchema } from "./tool-adapter.js";
export { PIPELINE_NAMES, needsPipeline, runPipelines, type PipelineName } from "./utils/pipelines.js";
export { TOOL, PKG } from "./tool-id.js";
