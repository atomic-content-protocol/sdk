import {
  computeContentHash,
  computeTokenCounts,
  normalizeBody,
  RelationshipEdgeSchema,
} from "@atomic-content-protocol/core";
import { z } from "zod";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the ACO to update"),
  title: z.string().optional().describe("New title"),
  body: z.string().optional().describe("Replacement Markdown body. content_hash and token_counts are recomputed."),
  tags: z.array(z.string()).optional().describe("Replacement tag list"),
  summary: z.string().max(500).optional().describe("Summary text (max 500 characters)"),
  status: z.enum(["draft", "final", "archived"]).optional().describe("Lifecycle status"),
  visibility: z.enum(["public", "private", "restricted"]).optional().describe("Discovery visibility"),
  agent_accessible: z
    .boolean()
    .optional()
    .describe("Whether AI agents can access this ACO via agent transport protocols"),
  rights: z.string().optional().describe("Rights statement or license identifier"),
  relationships: z
    .array(RelationshipEdgeSchema)
    .optional()
    .describe(
      "Replacement list of relationship edges ({ rel_type, target_id, confidence? }). Use detect_relationships to get suggestions."
    ),
});

const definition: ACPToolDefinition = {
  name: "update_aco",
  description:
    "Update mutable fields of an existing ACO: title, body, tags, summary, status, visibility, agent_accessible, rights, relationships. Immutable fields (id, created, source_type, author, object_type, acp_version) are never changed. Updates the modified timestamp automatically.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
};

/** Fields that must never be altered after creation. */
const IMMUTABLE_FIELDS = ["id", "created", "source_type", "author", "object_type", "acp_version"] as const;

export function createUpdateACOTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, body, ...updates } = inputSchema.parse(input);

      const aco = await ctx.storage.getACO(id);
      if (!aco) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      const frontmatter: Record<string, unknown> = { ...aco.frontmatter };
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) frontmatter[key] = value;
      }

      let newBody = aco.body;
      if (body !== undefined && body !== aco.body) {
        newBody = body;
        if ("content_hash" in frontmatter) frontmatter["content_hash"] = computeContentHash(normalizeBody(body));
        if ("token_counts" in frontmatter) frontmatter["token_counts"] = await computeTokenCounts(body);
      }

      // Re-lock immutable fields from the original
      for (const field of IMMUTABLE_FIELDS) {
        if (field in aco.frontmatter) frontmatter[field] = aco.frontmatter[field];
      }

      frontmatter["modified"] = new Date().toISOString();

      await ctx.storage.putACO({ frontmatter, body: newBody });
      return { success: true, data: frontmatter };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
