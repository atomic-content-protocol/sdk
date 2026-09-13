import { z } from "zod";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";

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

export function createListContainersTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { limit, offset } = inputSchema.parse(input);
      const containers = await ctx.storage.listContainers({ limit, offset });

      const items = containers.map((c) => c.frontmatter);

      return {
        success: true,
        data: { items, count: items.length, offset, limit },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
