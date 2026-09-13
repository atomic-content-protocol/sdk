import { z } from "zod";
import { SOURCE_TYPES } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";
import { sortACOs } from "../../utils/storage.js";

const inputSchema = z.object({
  limit: z.number().int().positive().max(500).optional().default(50).describe("Maximum number of ACOs to return"),
  offset: z.number().int().nonnegative().optional().default(0).describe("Number of ACOs to skip (for pagination)"),
  sortBy: z.enum(["created", "modified", "title"]).optional().default("created").describe("Field to sort by"),
  order: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort direction"),
  tags: z.array(z.string()).optional().describe("Filter: return ACOs with at least one of these tags"),
  status: z.array(z.enum(["draft", "final", "archived"])).optional().describe("Filter: return ACOs with one of these statuses"),
  source_type: z.array(z.enum(SOURCE_TYPES)).optional().describe("Filter: return ACOs with one of these source types"),
  visibility: z.array(z.enum(["public", "private", "restricted"])).optional().describe("Filter: return ACOs with one of these visibility values"),
});

const definition: ACPToolDefinition = {
  name: "list_acos",
  description:
    "List ACOs in the vault with optional filtering by tags, status, source_type, and visibility. Sorting and pagination apply after filtering. Returns frontmatter only (no body) for efficiency.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

export function createListACOsTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { limit, offset, sortBy, order, tags, status, source_type, visibility } = inputSchema.parse(input);
      const hasFilters = Boolean(tags || status || source_type || visibility);

      let total: number;
      let page;
      if (hasFilters) {
        const filtered = sortACOs(await ctx.storage.queryACOs({ tags, status, source_type, visibility }), sortBy, order);
        total = filtered.length;
        page = filtered.slice(offset, offset + limit);
      } else {
        page = await ctx.storage.listACOs({ limit, offset, sortBy, order });
        total = page.length < limit && offset === 0 ? page.length : -1;
      }

      const items = page.map((aco) => aco.frontmatter);
      return {
        success: true,
        data: { items, count: items.length, offset, limit, ...(total >= 0 ? { total } : {}) },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
