import { z } from "zod";
import type { ACO } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";
import { extractStrings, extractEntityNames, jaccard, tokens, titleOf, idOf } from "../../utils/frontmatter.js";
import { listAllACOs } from "../../utils/storage.js";
import { embeddingText } from "../../utils/pipelines.js";

const inputSchema = z
  .object({
    id: z.string().optional().describe("UUID of the source ACO to find similar ACOs for"),
    text: z.string().optional().describe("Arbitrary text to find similar ACOs for"),
    limit: z.number().int().positive().max(100).optional().default(10).describe("Maximum number of results to return"),
    threshold: z.number().min(0).max(1).optional().describe("Minimum similarity score (0.0–1.0). Results below this are excluded."),
  })
  .refine((d) => Boolean(d.id) !== Boolean(d.text), { message: "Provide either id or text, not both" });

const definition: ACPToolDefinition = {
  name: "find_similar",
  description:
    "Find ACOs similar to a given ACO (by id) or to arbitrary text. Uses stored vector embeddings when the vault has them (run enrich_aco with the 'embed' pipeline) and an embedding-capable provider is configured; otherwise falls back to tag/entity/title overlap.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

// ---------------------------------------------------------------------------
// Overlap fallbacks (no vectors)
// ---------------------------------------------------------------------------

function acoOverlap(source: ACO, candidate: ACO): number {
  const tagScore = jaccard(extractStrings(source.frontmatter["tags"]), extractStrings(candidate.frontmatter["tags"]));
  const entityScore = jaccard(extractEntityNames(source.frontmatter["key_entities"]), extractEntityNames(candidate.frontmatter["key_entities"]));
  const titleScore = jaccard(tokens(titleOf(source.frontmatter) ?? ""), tokens(titleOf(candidate.frontmatter) ?? ""));
  return tagScore * 0.4 + entityScore * 0.4 + titleScore * 0.2;
}

function textOverlap(text: string, candidate: ACO): number {
  const query = tokens(text);
  const haystack = [
    ...tokens(titleOf(candidate.frontmatter) ?? ""),
    ...extractStrings(candidate.frontmatter["tags"]).flatMap(tokens),
    ...extractEntityNames(candidate.frontmatter["key_entities"]).flatMap(tokens),
    ...tokens(String(candidate.frontmatter["summary"] ?? "")),
  ];
  return jaccard(query, haystack);
}

export function createFindSimilarTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, text, limit, threshold } = inputSchema.parse(input);

      let source: ACO | null = null;
      if (id) {
        source = await ctx.storage.getACO(id);
        if (!source) return { success: false, error: `ACO not found: ${id}` };
      }
      const queryText = text ?? embeddingText(source as ACO);

      // ------------------------------------------------------------------
      // Path 1: vector search over stored embeddings
      // ------------------------------------------------------------------
      if (ctx.hasEnrichment && typeof ctx.storage.findSimilar === "function") {
        try {
          const provider = ctx.getProvider();
          if (provider.embed) {
            const vector = await provider.embed(queryText);
            const hits = (await ctx.storage.findSimilar(vector, { limit: limit + 1, threshold })).filter((r) => r.id !== id);
            if (hits.length > 0) {
              return {
                success: true,
                data: {
                  query: id ? { source_id: id } : { text: text?.slice(0, 120) },
                  method: "vector",
                  results: hits.slice(0, limit).map((r) => ({
                    id: r.id,
                    title: titleOf(r.frontmatter),
                    similarity_score: Number(r.score.toFixed(4)),
                  })),
                },
              };
            }
            // No stored vectors matched — fall through to overlap so the caller still gets results.
          }
        } catch {
          // No embedding-capable provider — fall through.
        }
      }

      // ------------------------------------------------------------------
      // Path 2: overlap fallback
      // ------------------------------------------------------------------
      const all = (await listAllACOs(ctx.storage)).filter((a) => idOf(a.frontmatter) !== id);
      const minScore = threshold ?? 0.05;
      const results = all
        .map((candidate) => ({
          id: idOf(candidate.frontmatter),
          title: titleOf(candidate.frontmatter),
          similarity_score: Number((source ? acoOverlap(source, candidate) : textOverlap(queryText, candidate)).toFixed(4)),
        }))
        .filter((r) => r.similarity_score >= minScore && r.similarity_score > 0)
        .sort((a, b) => b.similarity_score - a.similarity_score)
        .slice(0, limit);

      return {
        success: true,
        data: {
          query: id ? { source_id: id } : { text: text?.slice(0, 120) },
          method: "content_overlap",
          note: "No stored embeddings matched (or no embedding-capable provider). Using tag/entity/title overlap. Run enrich_aco with pipelines ['embed'] to enable vector search.",
          results,
        },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
