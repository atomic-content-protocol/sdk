import { createACO, SOURCE_TYPES } from "@atomic-content-protocol/core";
import { z } from "zod";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  title: z.string().optional().describe("Human-readable title for the ACO"),
  body: z.string().optional().default("").describe("Markdown body content"),
  source_type: z.enum(SOURCE_TYPES).optional().default("manual").describe("How the ACO was created"),
  author_id: z.string().min(1).describe("Unique identifier for the author"),
  author_name: z.string().min(1).describe("Human-readable display name for the author"),
  tags: z.array(z.string()).optional().describe("Tags to apply to the ACO"),
  visibility: z.enum(["public", "private", "restricted"]).optional().describe("Discovery visibility of the ACO"),
  source_url: z.string().url().optional().describe("Original URL (required when source_type is 'link')"),
  source_context: z
    .record(z.unknown())
    .optional()
    .describe("LLM session provenance (used when source_type is 'llm_capture')"),
});

const definition: ACPToolDefinition = {
  name: "create_aco",
  description:
    "Create a new Atomic Content Object (ACO) and persist it to the vault. Returns the created ACO's frontmatter including its generated id.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
};

export function createCreateACOTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const validated = inputSchema.parse(input);

      const extraFrontmatter: Record<string, unknown> = {};
      if (validated.tags) extraFrontmatter["tags"] = validated.tags;
      if (validated.visibility) extraFrontmatter["visibility"] = validated.visibility;
      if (validated.source_url) extraFrontmatter["source_url"] = validated.source_url;
      if (validated.source_context) extraFrontmatter["source_context"] = validated.source_context;

      const aco = await createACO({
        title: validated.title,
        body: validated.body,
        source_type: validated.source_type,
        author: { id: validated.author_id, name: validated.author_name },
        frontmatter: extraFrontmatter,
      });

      await ctx.storage.putACO(aco);

      return {
        success: true,
        data: {
          id: aco.frontmatter["id"],
          ...aco.frontmatter,
        },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
