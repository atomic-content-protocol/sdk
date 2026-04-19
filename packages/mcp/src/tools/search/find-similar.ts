import { z } from "zod";
import { ProviderRouter } from "@atomic-content-protocol/enrichment";
import type { IStorageAdapter, ACO } from "@atomic-content-protocol/core";
import type { ProviderConfig } from "@atomic-content-protocol/enrichment";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import { cosineSimilarity } from "../../utils/similarity.js";

const inputSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe("UUID of the source ACO to find similar ACOs for"),
    text: z
      .string()
      .optional()
      .describe("Arbitrary text to find similar ACOs for"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(10)
      .describe("Maximum number of results to return"),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Minimum similarity score (0.0–1.0). Results below this are excluded."),
  })
  .refine((data) => data.id || data.text, {
    message: "Provide either id or text",
  });

const definition: ACPToolDefinition = {
  name: "find_similar",
  description:
    "Find ACOs that are semantically similar to a given ACO (by id) or arbitrary text. Uses vector embeddings when the storage adapter and an enrichment provider with embed() support are available; falls back to tag/entity/title overlap otherwise.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

// ---------------------------------------------------------------------------
// Fallback: basic content similarity via tag/entity/title overlap (no vectors)
// ---------------------------------------------------------------------------

function simpleOverlapScore(source: ACO, candidate: ACO): number {
  function extractStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string");
  }
  function extractEntityNames(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
      .map((v) => String(v["name"] ?? ""))
      .filter(Boolean);
  }
  function jaccard(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const setB = new Set(b.map((s) => s.toLowerCase()));
    const intersection = a.filter((s) => setB.has(s.toLowerCase())).length;
    const union = new Set([
      ...a.map((s) => s.toLowerCase()),
      ...b.map((s) => s.toLowerCase()),
    ]).size;
    return intersection / union;
  }

  const sourceTags = extractStrings(source.frontmatter["tags"]);
  const candidateTags = extractStrings(candidate.frontmatter["tags"]);
  const sourceEntities = extractEntityNames(source.frontmatter["key_entities"]);
  const candidateEntities = extractEntityNames(candidate.frontmatter["key_entities"]);

  const tagScore = jaccard(sourceTags, candidateTags);
  const entityScore = jaccard(sourceEntities, candidateEntities);

  // Partial title word overlap
  const sourceTitle = String(source.frontmatter["title"] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const candidateTitle = String(candidate.frontmatter["title"] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const titleScore = jaccard(sourceTitle, candidateTitle);

  return tagScore * 0.4 + entityScore * 0.4 + titleScore * 0.2;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createFindSimilarTool(
  storage: IStorageAdapter,
  enrichmentConfig?: { providers: ProviderConfig }
): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, text, limit, threshold } = inputSchema.parse(input);

      // ------------------------------------------------------------------
      // Path 1: vector search — requires both storage.findSimilar AND an
      //          enrichment provider that can embed()
      // ------------------------------------------------------------------

      const hasVectorStorage =
        typeof storage.findSimilar === "function" &&
        typeof storage.putEmbedding === "function";

      // Build a router only if enrichment is configured
      let router: ProviderRouter | null = null;
      let routerSupportsEmbed = false;
      if (enrichmentConfig) {
        try {
          router = ProviderRouter.fromConfig(enrichmentConfig.providers);
          // Test whether any provider in the router supports embed by checking
          // the underlying providers. We probe the router's embed method — it
          // will throw synchronously if no provider supports it.
          routerSupportsEmbed = true; // Assume yes; will catch at call time
        } catch {
          router = null;
        }
      }

      if (hasVectorStorage && router !== null) {
        // Determine query text
        let queryText: string;

        if (text) {
          queryText = text;
        } else if (id) {
          const aco = await storage.getACO(id);
          if (!aco) {
            return { success: false, error: `ACO not found: ${id}` };
          }
          const title = String(aco.frontmatter["title"] ?? "");
          const body = aco.body ?? "";
          queryText = [title, body].filter(Boolean).join("\n\n");
        } else {
          return { success: false, error: "Provide either id or text" };
        }

        let vector: number[];
        try {
          vector = await router.embed(queryText);
          routerSupportsEmbed = true;
        } catch (embedErr) {
          // embed() not available from any provider — fall through to content fallback
          routerSupportsEmbed = false;
          vector = [];
        }

        if (routerSupportsEmbed && vector.length > 0) {
          const results = await storage.findSimilar!(vector, { limit, threshold });

          // Filter out the source ACO itself when querying by id
          const filtered = id
            ? results.filter((r) => r.id !== id)
            : results;

          return {
            success: true,
            data: {
              query: id ? { source_id: id } : { text: text?.slice(0, 120) },
              method: "vector",
              results: filtered.map((r) => ({
                id: r.id,
                title: (r.frontmatter["title"] as string | null) ?? null,
                similarity_score: r.score,
              })),
            },
          };
        }
      }

      // ------------------------------------------------------------------
      // Path 2: content fallback (tag/entity/title Jaccard overlap)
      //         Used when: no vector storage, no embed-capable provider,
      //         or text input with no embed support.
      // ------------------------------------------------------------------

      if (id) {
        const source = await storage.getACO(id);
        if (!source) {
          return { success: false, error: `ACO not found: ${id}` };
        }

        const all = await storage.listACOs({ limit: 500 });
        const candidates = all.filter(
          (a) => a.frontmatter["id"] !== id
        );

        const scored = candidates
          .map((candidate) => ({
            id: String(candidate.frontmatter["id"] ?? ""),
            title: (candidate.frontmatter["title"] as string | null) ?? null,
            similarity_score: simpleOverlapScore(source, candidate),
          }))
          .filter((r) => r.similarity_score > 0.05)
          .sort((a, b) => b.similarity_score - a.similarity_score)
          .slice(0, limit);

        return {
          success: true,
          data: {
            query: { source_id: id },
            method: "content_overlap",
            note: "Vector embeddings not available. Using tag/entity/title overlap as a similarity signal.",
            results: scored,
          },
        };
      }

      // text-only with no embed support and no id
      return {
        success: false,
        error:
          "Text-based similarity requires an embedding-capable provider (OpenAI or Ollama). " +
          "Either configure an enrichment provider with embed() support or provide an id instead.",
        metadata: {
          hint: "Configure openai or ollama in enrichmentConfig to enable text-based semantic search.",
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
