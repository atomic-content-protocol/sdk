import { z } from "zod";
import type { IStorageAdapter, ACO } from "@acp/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

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
    "Detect potential relationships between an ACO and other ACOs based on tag and entity overlap. Returns suggestions only — does NOT auto-apply relationships. Review and confirm before writing back.",
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

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b.map((s) => s.toLowerCase()));
  const intersection = a.filter((s) => setB.has(s.toLowerCase())).length;
  const union = new Set([...a.map((s) => s.toLowerCase()), ...b.map((s) => s.toLowerCase())]).size;
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

export function createDetectRelationshipsTool(storage: IStorageAdapter): ToolEntry {
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
      candidates = candidates.filter(
        (a) => a.frontmatter["id"] !== id
      );

      // Source signals
      const sourceTags = extractStrings(source.frontmatter["tags"]);
      const sourceEntities = extractEntityNames(source.frontmatter["key_entities"]);
      const sourceClassification = source.frontmatter["classification"] as string | undefined;

      const suggestions: RelationshipSuggestion[] = [];

      for (const candidate of candidates) {
        const cid = String(candidate.frontmatter["id"] ?? "");
        const ctitle = candidate.frontmatter["title"] as string | null ?? null;
        const candidateTags = extractStrings(candidate.frontmatter["tags"]);
        const candidateEntities = extractEntityNames(candidate.frontmatter["key_entities"]);
        const candidateClassification = candidate.frontmatter["classification"] as string | undefined;

        const tagScore = overlapScore(sourceTags, candidateTags);
        const entityScore = overlapScore(sourceEntities, candidateEntities);
        const classMatch =
          sourceClassification &&
          candidateClassification &&
          sourceClassification === candidateClassification;

        const combined = tagScore * 0.5 + entityScore * 0.4 + (classMatch ? 0.1 : 0);

        if (combined < 0.05) continue; // Too weak — skip

        // Determine rel_type heuristic
        let rel_type = "related";
        if (entityScore > 0.5) rel_type = "references";
        else if (classMatch && tagScore > 0.3) rel_type = "supports";

        const reasons: string[] = [];
        if (tagScore > 0) {
          const sharedTags = sourceTags.filter((t) =>
            candidateTags.map((ct) => ct.toLowerCase()).includes(t.toLowerCase())
          );
          reasons.push(`shared tags: ${sharedTags.slice(0, 3).join(", ")}`);
        }
        if (entityScore > 0) {
          const sharedEntities = sourceEntities.filter((e) =>
            candidateEntities.map((ce) => ce.toLowerCase()).includes(e.toLowerCase())
          );
          reasons.push(`shared entities: ${sharedEntities.slice(0, 3).join(", ")}`);
        }
        if (classMatch) reasons.push(`same classification: ${sourceClassification}`);

        suggestions.push({
          target_id: cid,
          target_title: ctitle,
          rel_type,
          confidence: Math.min(combined, 1),
          reason: reasons.join("; ") || "low overlap",
        });
      }

      // Sort by confidence descending, trim to max_results
      suggestions.sort((a, b) => b.confidence - a.confidence);
      const top = suggestions.slice(0, max_results);

      return {
        success: true,
        data: {
          source_id: id,
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
