import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodType } from "zod";
import type { ACPToolDefinition } from "./types/tool.js";

/**
 * Convert a Zod schema to a JSON Schema object (jsonSchema7 target).
 */
export function zodSchemaToJsonSchema(
  schema: ZodType<unknown>
): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<
    string,
    unknown
  >;
}

/**
 * Adapt an ACPToolDefinition to the shape the MCP SDK expects for ListTools.
 *
 * The MCP SDK wants:
 *   { name, description, inputSchema: <JSON Schema object>, annotations? }
 */
export function adaptToolForMCP(toolDef: ACPToolDefinition) {
  const inputSchema = zodSchemaToJsonSchema(toolDef.inputSchema);

  return {
    name: toolDef.name,
    description: toolDef.description,
    inputSchema,
    ...(toolDef.annotations !== undefined && {
      annotations: toolDef.annotations,
    }),
  };
}
