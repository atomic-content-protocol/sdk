import { z } from "zod";
import type { IStorageAdapter } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  query: z.string().min(1).describe("Full-text search query applied to title and body"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Additionally filter by these tags (AND with query)"),
  status: z
    .array(z.enum(["draft", "final", "archived"]))
    .optional()
    .describe("Filter by lifecycle status"),
  source_type: z
    .array(
      z.enum([
        "link",
        "uploaded_md",
        "manual",
        "converted_pdf",
        "converted_doc",
        "converted_video",
        "selected_text",
        "llm_capture",
      ])
    )
    .optional()
    .describe("Filter by source type"),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(20)
    .describe("Maximum number of results to return"),
});

const definition: ACPToolDefinition = {
  name: "search_acos",
  description:
    "Full-text search across ACOs in the vault. Returns frontmatter of matching ACOs (no body).",
  inputSchema,
  annotations: { readOnlyHint: true },
};

export function createSearchACOsTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { query, tags, status, source_type, limit } = inputSchema.parse(input);

      const acos = await storage.queryACOs({
        search: query,
        tags,
        status,
        source_type,
      });

      const items = acos.slice(0, limit).map((aco) => aco.frontmatter);

      return {
        success: true,
        data: {
          query,
          items,
          count: items.length,
        },
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
