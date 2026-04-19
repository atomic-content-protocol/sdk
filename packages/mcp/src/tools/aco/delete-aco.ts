import { z } from "zod";
import type { IStorageAdapter } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the ACO to delete"),
  hard: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, permanently deletes the ACO. If false (default), soft-deletes by setting status to 'archived'."
    ),
});

const definition: ACPToolDefinition = {
  name: "delete_aco",
  description:
    "Delete an ACO. Soft delete (default) sets status to 'archived'. Hard delete permanently removes the object.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
};

export function createDeleteACOTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, hard } = inputSchema.parse(input);

      if (hard) {
        await storage.deleteACO(id);
        return {
          success: true,
          data: { id, deleted: true, mode: "hard" },
        };
      }

      // Soft delete: read → set status archived → write back
      const aco = await storage.getACO(id);
      if (!aco) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      const updatedFrontmatter: Record<string, unknown> = {
        ...aco.frontmatter,
        status: "archived",
        modified: new Date().toISOString(),
      };
      await storage.putACO({ ...aco, frontmatter: updatedFrontmatter });

      return {
        success: true,
        data: { id, deleted: true, mode: "soft" },
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
