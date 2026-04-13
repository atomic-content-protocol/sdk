import { z } from "zod";
import { ProviderRouter } from "@acp/enrichment";
import type { IStorageAdapter, ACO } from "@acp/core";
import type { ProviderConfig } from "@acp/enrichment";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import { cosineSimilarity } from "../../utils/similarity.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the source ACO to find relationships for"),
  candidate_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Specific ACO ids to compare against. If not provided, compares against all ACOs in the vault."
    ),
  max_results: z
    .number()
    .int()
    .positive()
    .optional()
    .default(10)
    .describe("Maximum number of relationship suggestions to return"),
});

const definition: ACPToolDefinition = {
  name: "detect_relationships",
  description:
    "Detect potential relationships between an ACO and other ACOs. Uses semantic embeddings (when available) combined with tag and entity overlap for higher accuracy. Returns suggestions only — does NOT auto-apply relationships. Review and confirm before writing back.",
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

// ---------------------------------------------------------------------------
// Overlap helpers
// ---------------------------------------------------------------------------

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b.map((s) => s.toLowerCase()));
  const intersection = a.filter((s) => setB.has(s.toLowerCase())).length;
  const union = new Set([
    ...a.map((s) => s.toLowerCase()),
    ...b.map((s) => s.toLowerCase()),
  ]).size;
  return intersection / union; // Jaccard similarity
}

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

function buildACOText(aco: ACO): string {
  const title = String(aco.frontmatter["title"] ?? "");
  const body = aco.body ?? "";
  return [title, body].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createDetectRelationshipsTool(
  storage: IStorageAdapter,
  enrichmentConfig?: { providers: ProviderConfig }
): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, candidate_ids, max_results } = inputSchema.parse(input);

      const source = await storage.getACO(id);
      if (!source) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      // Load candidates
      let candidates: ACO[];
      if (candidate_ids && candidate_ids.length > 0) {
        const results = await Promise.all(
          candidate_ids.map((cid) => storage.getACO(cid))
        );
        candidates = results.filter((a): a is ACO => a !== null);
      } else {
        candidates = await storage.listACOs({ limit: 500 });
      }

      // Exclude the source itself
      candidates = candidates.filter((a) => a.frontmatter["id"] !== id);

      // ------------------------------------------------------------------
      // Determine if we can use embeddings
      // ------------------------------------------------------------------

      let router: ProviderRouter | null = null;
      if (enrichmentConfig) {
        try {
          router = ProviderRouter.fromConfig(enrichmentConfig.providers);
        } catch {
          router = null;
        }
      }

      // Try to embed the source ACO; if it fails we fall back to Jaccard-only
      let sourceVector: number[] | null = null;
      if (router !== null) {
        try {
          sourceVector = await router.embed(buildACOText(source));
        } catch {
          sourceVector = null;
        }
      }

      // Source signals for Jaccard
      const sourceTags = extractStrings(source.frontmatter["tags"]);
      const sourceEntities = extractEntityNames(source.frontmatter["key_entities"]);
      const sourceClassification = source.frontmatter["classification"] as string | undefined;

      const suggestions: RelationshipSuggestion[] = [];
      const methodUsed = sourceVector !== null ? "embedding+jaccard" : "jaccard";

      for (const candidate of candidates) {
        const cid = String(candidate.frontmatter["id"] ?? "");
        const ctitle = (candidate.frontmatter["title"] as string | null) ?? null;
        const candidateTags = extractStrings(candidate.frontmatter["tags"]);
        const candidateEntities = extractEntityNames(candidate.frontmatter["key_entities"]);
        const candidateClassification = candidate.frontmatter["classification"] as
          | string
          | undefined;

        // --- Jaccard signals ---
        const tagScore = overlapScore(sourceTags, candidateTags);
        const entityScore = overlapScore(sourceEntities, candidateEntities);
        const classMatch =
          sourceClassification &&
          candidateClassification &&
          sourceClassification === candidateClassification;

        const jaccardScore = tagScore * 0.5 + entityScore * 0.4 + (classMatch ? 0.1 : 0);

        // --- Cosine similarity (when available) ---
        let cosine = 0;
        if (sourceVector !== null) {
          try {
            const candidateVector = await router!.embed(buildACOText(candidate));
            cosine = cosineSimilarity(sourceVector, candidateVector);
            // Normalise to [0,1] — cosine can be negative for very dissimilar text
            cosine = Math.max(0, cosine);
          } catch {
            cosine = 0;
          }
        }

        // --- Combined score ---
        let combined: number;
        if (sourceVector !== null) {
          combined = 0.4 * jaccardScore + 0.6 * cosine;
        } else {
          combined = jaccardScore;
        }

        if (combined < 0.05) continue; // Too weak — skip

        // --- Relationship type heuristic ---
        let rel_type = "related";
        if (entityScore > 0.5) rel_type = "references";
        else if (classMatch && tagScore > 0.3) rel_type = "supports";

        // --- Reason string ---
        const reasonParts: string[] = [];

        if (sourceVector !== null && cosine > 0) {
          reasonParts.push(`High semantic similarity (${cosine.toFixed(2)})`);
        }

        if (tagScore > 0) {
          const sharedTags = sourceTags.filter((t) =>
            candidateTags.map((ct) => ct.toLowerCase()).includes(t.toLowerCase())
          );
          if (sharedTags.length > 0) {
            reasonParts.push(`shared tags: ${sharedTags.slice(0, 3).join(", ")}`);
          }
        }

        if (entityScore > 0) {
          const sharedEntities = sourceEntities.filter((e) =>
            candidateEntities.map((ce) => ce.toLowerCase()).includes(e.toLowerCase())
          );
          if (sharedEntities.length > 0) {
            reasonParts.push(`shared entities: ${sharedEntities.slice(0, 3).join(", ")}`);
          }
        }

        if (classMatch) {
          reasonParts.push(`same classification: ${sourceClassification}`);
        }

        suggestions.push({
          target_id: cid,
          target_title: ctitle,
          rel_type,
          confidence: Math.min(combined, 1),
          reason: reasonParts.join(" + ") || "low overlap",
        });
      }

      // Sort by confidence descending, trim to max_results
      suggestions.sort((a, b) => b.confidence - a.confidence);
      const top = suggestions.slice(0, max_results);

      return {
        success: true,
        data: {
          source_id: id,
          method: methodUsed,
          suggestions: top,
          note: "These are suggestions only. Use update_aco to apply relationships after review.",
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
