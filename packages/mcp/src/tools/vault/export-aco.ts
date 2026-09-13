import { z } from "zod";
import { serializeACO } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the ACO to export"),
  format: z
    .enum(["markdown", "json"])
    .optional()
    .default("markdown")
    .describe("Export format: 'markdown' returns the raw YAML+Markdown string, 'json' returns a JSON object"),
});

const definition: ACPToolDefinition = {
  name: "export_aco",
  description:
    "Export an ACO as a markdown string (YAML frontmatter + body) or a JSON object. Useful for extracting ACOs to external systems.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

export function createExportACOTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, format } = inputSchema.parse(input);
      const aco = await ctx.storage.getACO(id);

      if (!aco) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      if (format === "json") {
        return {
          success: true,
          data: {
            frontmatter: aco.frontmatter,
            body: aco.body,
          },
        };
      }

      // Markdown: YAML frontmatter + body
      const markdown = serializeACO(aco.frontmatter, aco.body);
      return {
        success: true,
        data: {
          id,
          format: "markdown",
          content: markdown,
        },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
