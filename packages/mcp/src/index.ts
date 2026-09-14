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

export type { ToolContext } from "./context.js";
export { EnrichmentNotConfiguredError } from "./context.js";
export type { ACPMCPServerConfig, EnrichmentConfig } from "./server.js";
export { ACPMCPServer } from "./server.js";
export { adaptToolForMCP, zodSchemaToJsonSchema } from "./tool-adapter.js";
export { PKG, TOOL } from "./tool-id.js";
export {
  clearRegistry,
  getAllTools,
  getToolHandler,
  registerTool,
  ToolRegistry,
  toolExists,
} from "./tool-registry.js";
export type {
  ACPToolDefinition,
  ToolAnnotations,
  ToolEntry,
  ToolHandler,
  ToolOutput,
} from "./types/tool.js";
export {
  needsPipeline,
  PIPELINE_NAMES,
  type PipelineName,
  type RunPipelinesResult,
  runPipelines,
} from "./utils/pipelines.js";
