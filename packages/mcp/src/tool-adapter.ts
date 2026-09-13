import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ACPToolDefinition } from "./types/tool.js";

/**
 * Convert a Zod schema to a JSON Schema object (jsonSchema7 target).
 *
 * The `$schema` key is stripped: MCP `inputSchema` is a bare JSON Schema
 * object and some strict clients reject the extra key.
 */
export function zodSchemaToJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  const { $schema: _omit, ...rest } = zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>;
  return rest;
}

/**
 * Adapt an ACPToolDefinition to the shape the MCP SDK expects for ListTools.
 *
 *   { name, description, inputSchema: <JSON Schema object>, annotations? }
 */
export function adaptToolForMCP(toolDef: ACPToolDefinition) {
  return {
    name: toolDef.name,
    description: toolDef.description,
    inputSchema: zodSchemaToJsonSchema(toolDef.inputSchema),
    ...(toolDef.annotations !== undefined && { annotations: toolDef.annotations }),
  };
}
