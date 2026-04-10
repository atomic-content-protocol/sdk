import type { ZodType } from "zod";

/**
 * MCP Tool Safety Annotations (per MCP spec).
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

/**
 * ACP Tool Definition — describes a single tool exposed via MCP.
 */
export interface ACPToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodType<unknown>;
  annotations?: ToolAnnotations;
}

/**
 * Standardised output from every tool handler.
 */
export interface ToolOutput {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A tool handler is an async function that accepts validated input
 * and returns a ToolOutput.
 */
export type ToolHandler = (input: unknown) => Promise<ToolOutput>;

/**
 * A registry entry pairing a tool definition with its handler.
 */
export interface ToolEntry {
  definition: ACPToolDefinition;
  handler: ToolHandler;
}
