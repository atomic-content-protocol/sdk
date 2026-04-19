import { z } from "zod";
import type { IStorageAdapter } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the ACO to update"),
  title: z.string().optional().describe("New title"),
  tags: z.array(z.string()).optional().describe("Replacement tag list"),
  summary: z.string().optional().describe("Summary text"),
  status: z
    .enum(["draft", "final", "archived"])
    .optional()
    .describe("Lifecycle status"),
  visibility: z
    .enum(["public", "private", "restricted"])
    .optional()
    .describe("Discovery visibility"),
  agent_accessible: z
    .boolean()
    .optional()
    .describe("Whether AI agents can access this ACO via agent transport protocols"),
  rights: z
    .string()
    .optional()
    .describe("Rights statement or license identifier"),
});

const definition: ACPToolDefinition = {
  name: "update_aco",
  description:
    "Update mutable fields of an existing ACO. Immutable fields (id, created, source_type, author, object_type) are ignored. Updates the modified timestamp automatically.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
};

/** Fields that must never be altered after creation. */
const IMMUTABLE_FIELDS = new Set([
  "id",
  "created",
  "source_type",
  "author",
  "object_type",
  "acp_version",
  "content_hash",
  "token_counts",
]);

export function createUpdateACOTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const validated = inputSchema.parse(input);
      const { id, ...updates } = validated;

      const aco = await storage.getACO(id);
      if (!aco) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      // Build updated frontmatter — merge, then lock immutable fields back in
      const updatedFrontmatter: Record<string, unknown> = { ...aco.frontmatter };

      if (updates.title !== undefined) updatedFrontmatter["title"] = updates.title;
      if (updates.tags !== undefined) updatedFrontmatter["tags"] = updates.tags;
      if (updates.summary !== undefined) updatedFrontmatter["summary"] = updates.summary;
      if (updates.status !== undefined) updatedFrontmatter["status"] = updates.status;
      if (updates.visibility !== undefined) updatedFrontmatter["visibility"] = updates.visibility;
      if (updates.agent_accessible !== undefined) updatedFrontmatter["agent_accessible"] = updates.agent_accessible;
      if (updates.rights !== undefined) updatedFrontmatter["rights"] = updates.rights;

      // Re-lock immutable fields from the original
      for (const field of IMMUTABLE_FIELDS) {
        if (field in aco.frontmatter) {
          updatedFrontmatter[field] = aco.frontmatter[field];
        }
      }

      // Update modified timestamp
      updatedFrontmatter["modified"] = new Date().toISOString();

      const updatedACO = { ...aco, frontmatter: updatedFrontmatter };
      await storage.putACO(updatedACO);

      return { success: true, data: updatedFrontmatter };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return { definition, handler };
}
