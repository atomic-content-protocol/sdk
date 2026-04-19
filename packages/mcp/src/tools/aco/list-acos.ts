import { z } from "zod";
import type { IStorageAdapter } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(50)
    .describe("Maximum number of ACOs to return"),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0)
    .describe("Number of ACOs to skip (for pagination)"),
  sortBy: z
    .enum(["created", "modified", "title"])
    .optional()
    .default("created")
    .describe("Field to sort by"),
  order: z
    .enum(["asc", "desc"])
    .optional()
    .default("desc")
    .describe("Sort direction"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Filter: return ACOs with at least one of these tags"),
  status: z
    .array(z.enum(["draft", "final", "archived"]))
    .optional()
    .describe("Filter: return ACOs with one of these statuses"),
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
    .describe("Filter: return ACOs with one of these source types"),
  visibility: z
    .array(z.enum(["public", "private", "restricted"]))
    .optional()
    .describe("Filter: return ACOs with one of these visibility values"),
});

const definition: ACPToolDefinition = {
  name: "list_acos",
  description:
    "List ACOs in the vault with optional filtering by tags, status, source_type, and visibility. Returns frontmatter only (no body) for efficiency.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

export function createListACOsTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const validated = inputSchema.parse(input);
      const { limit, offset, sortBy, order, tags, status, source_type, visibility } = validated;

      // Build query if any filters are set
      const hasFilters = tags || status || source_type || visibility;

      let acos;
      if (hasFilters) {
        acos = await storage.queryACOs({
          tags,
          status,
          source_type,
          visibility,
        });

        // Apply pagination manually after filtering
        acos = acos.slice(offset, offset + limit);
      } else {
        acos = await storage.listACOs({ limit, offset, sortBy, order });
      }

      // Return frontmatter only — bodies are too large for a list response
      const items = acos.map((aco) => aco.frontmatter);

      return {
        success: true,
        data: {
          items,
          count: items.length,
          offset,
          limit,
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
