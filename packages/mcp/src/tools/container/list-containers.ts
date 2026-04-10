import { z } from "zod";
import type { IStorageAdapter } from "@acp/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(50)
    .describe("Maximum number of containers to return"),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe("Number of containers to skip (for pagination)"),
});

const definition: ACPToolDefinition = {
  name: "list_containers",
  description:
    "List all containers in the vault. Returns frontmatter only (no body).",
  inputSchema,
  annotations: { readOnlyHint: true },
};

export function createListContainersTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { limit, offset } = inputSchema.parse(input);
      const containers = await storage.listContainers({ limit, offset });

      const items = containers.map((c) => c.frontmatter);

      return {
        success: true,
        data: { items, count: items.length, offset, limit },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return { definition, handler };
}
