import { z } from "zod";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import {
  calibrateCosine,
  extractEntityNames,
  extractStrings,
  idOf,
  jaccard,
  shared,
  titleOf,
} from "../../utils/frontmatter.js";
import { embeddingText } from "../../utils/pipelines.js";
import { listAllACOs, loadACOs } from "../../utils/storage.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the source ACO to find relationships for"),
  candidate_ids: z
    .array(z.string())
    .optional()
    .describe("Specific ACO ids to compare against. If not provided, compares against every ACO in the vault."),
  max_results: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(10)
    .describe("Maximum number of relationship suggestions to return"),
  min_confidence: z.number().min(0).max(1).optional().default(0.1).describe("Drop suggestions below this confidence"),
});

const definition: ACPToolDefinition = {
  name: "detect_relationships",
  description:
    "Suggest relationships between an ACO and other ACOs using tag/entity/classification overlap, combined with stored vector embeddings when the source and candidates have been embedded (run enrich_aco with the 'embed' pipeline). Returns suggestions only. Apply them with update_aco { relationships: [...] } after review.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

interface RelationshipSuggestion {
  target_id: string;
  target_title: string | null;
  rel_type: string;
  confidence: number;
  reason: string;
}

export function createDetectRelationshipsTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, candidate_ids, max_results, min_confidence } = inputSchema.parse(input);

      const source = await ctx.storage.getACO(id);
      if (!source) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      const candidates = (
        candidate_ids && candidate_ids.length > 0
          ? await loadACOs(ctx.storage, candidate_ids)
          : await listAllACOs(ctx.storage)
      ).filter((a) => idOf(a.frontmatter) !== id);

      // ------------------------------------------------------------------
      // Semantic signal: embed the source once and look up cosine against the
      // vault's *stored* embeddings. Candidates without a stored vector get
      // no semantic score rather than triggering an embedding call each.
      // ------------------------------------------------------------------
      const cosineById = new Map<string, number>();
      let semantic = false;
      if (ctx.hasEnrichment && typeof ctx.storage.findSimilar === "function") {
        try {
          const provider = ctx.getProvider();
          if (provider.embed) {
            const vector = await provider.embed(embeddingText(source));
            const hits = await ctx.storage.findSimilar(vector, { limit: 1_000, threshold: 0 });
            for (const hit of hits) cosineById.set(hit.id, hit.score);
            semantic = cosineById.size > 0;
          }
        } catch {
          semantic = false; // no embedding-capable provider or no vectors — Jaccard only
        }
      }

      const sourceTags = extractStrings(source.frontmatter["tags"]);
      const sourceEntities = extractEntityNames(source.frontmatter["key_entities"]);
      const sourceClass = source.frontmatter["classification"];

      const suggestions: RelationshipSuggestion[] = [];

      for (const candidate of candidates) {
        const cid = idOf(candidate.frontmatter);
        const candidateTags = extractStrings(candidate.frontmatter["tags"]);
        const candidateEntities = extractEntityNames(candidate.frontmatter["key_entities"]);
        const classMatch = Boolean(sourceClass) && sourceClass === candidate.frontmatter["classification"];

        const tagScore = jaccard(sourceTags, candidateTags);
        const entityScore = jaccard(sourceEntities, candidateEntities);
        const overlap = tagScore * 0.5 + entityScore * 0.4 + (classMatch ? 0.1 : 0);

        const rawCosine = cosineById.get(cid);
        const relevance = rawCosine !== undefined ? calibrateCosine(rawCosine) : undefined;
        const confidence = relevance !== undefined ? 0.4 * overlap + 0.6 * relevance : overlap;

        if (confidence < min_confidence) continue;

        let rel_type = "related";
        if (entityScore > 0.5) rel_type = "references";
        else if (classMatch && tagScore > 0.3) rel_type = "supports";

        const reasons: string[] = [];
        if (relevance !== undefined && relevance >= 0.3) {
          reasons.push(`${relevance >= 0.6 ? "high" : "moderate"} semantic similarity (${relevance.toFixed(2)})`);
        }
        const sharedTags = shared(sourceTags, candidateTags);
        if (sharedTags.length > 0) reasons.push(`shared tags: ${sharedTags.slice(0, 3).join(", ")}`);
        const sharedEntities = shared(sourceEntities, candidateEntities);
        if (sharedEntities.length > 0) reasons.push(`shared entities: ${sharedEntities.slice(0, 3).join(", ")}`);
        if (classMatch) reasons.push(`same classification: ${String(sourceClass)}`);

        suggestions.push({
          target_id: cid,
          target_title: titleOf(candidate.frontmatter),
          rel_type,
          confidence: Math.min(1, Number(confidence.toFixed(3))),
          reason: reasons.join(" + ") || "weak overlap",
        });
      }

      suggestions.sort((a, b) => b.confidence - a.confidence);

      return {
        success: true,
        data: {
          source_id: id,
          method: semantic ? "embedding+overlap" : "overlap",
          candidates_considered: candidates.length,
          suggestions: suggestions.slice(0, max_results),
          note: "Suggestions only. Apply with update_aco { id, relationships: [{ rel_type, target_id, confidence }] } after review.",
        },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
