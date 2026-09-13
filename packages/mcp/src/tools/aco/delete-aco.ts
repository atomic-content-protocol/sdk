import { z } from "zod";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the ACO to delete"),
  hard: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, permanently deletes the ACO. If false (default), soft-deletes by setting status to 'archived'."),
});

const definition: ACPToolDefinition = {
  name: "delete_aco",
  description:
    "Delete an ACO. Soft delete (default) sets status to 'archived'. Hard delete permanently removes the object and its embedding. Returns an error if the ACO does not exist.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
};

export function createDeleteACOTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, hard } = inputSchema.parse(input);

      const aco = await ctx.storage.getACO(id);
      if (!aco) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      if (hard) {
        await ctx.storage.deleteACO(id);
        return { success: true, data: { id, deleted: true, mode: "hard" } };
      }

      const updatedFrontmatter: Record<string, unknown> = {
        ...aco.frontmatter,
        status: "archived",
        modified: new Date().toISOString(),
      };
      await ctx.storage.putACO({ ...aco, frontmatter: updatedFrontmatter });
      return { success: true, data: { id, deleted: true, mode: "soft" } };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
