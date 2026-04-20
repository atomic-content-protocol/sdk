import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type {
  IEnrichmentPipeline,
  EnrichmentResult,
  EnrichmentOptions,
} from "./pipeline.interface.js";
import { buildTagPrompt } from "../utils/prompts.js";
import { createProvenanceRecord } from "../utils/provenance.js";

/**
 * TagPipeline — extracts 3-7 tags/keywords from ACO content.
 *
 * Idempotent: skips enrichment if `frontmatter.tags` and a provenance record
 * for "tags" already exist, unless `options.force` is true.
 */
export class TagPipeline implements IEnrichmentPipeline {
  readonly name = "tag";
  readonly field = "tags";

  async enrich(
    aco: ACO,
    provider: IEnrichmentProvider,
    options?: EnrichmentOptions
  ): Promise<EnrichmentResult> {
    const { frontmatter, body } = aco;

    // Idempotency check
    const existingTags = frontmatter["tags"];
    const existingProvenance = (
      frontmatter["provenance"] as Record<string, unknown> | undefined
    )?.["tags"];
    if (existingTags && existingProvenance && !options?.force) {
      return {
        aco,
        fieldUpdated: this.field,
        confidence: 0,
        model: "skipped",
      };
    }

    const title = String(frontmatter["title"] ?? "");
    const prompt = buildTagPrompt(title, body);

    const response = await provider.complete(prompt, {
      maxTokens: 150,
      temperature: 0.5,
    });

    // Parse JSON array from response — be lenient about surrounding text
    let tags: string[] = [];
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        const parsed: unknown = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          tags = parsed
            .filter((t): t is string => typeof t === "string")
            .slice(0, 7);
        }
      } catch {
        // Fall through — tags remains []
      }
    }

    const confidence = tags.length > 0 ? 0.85 : 0.0;
    const provRecord = createProvenanceRecord(provider.model, confidence, {
      pipeline: this.name,
      tool: options?.tool,
    });

    const updatedFrontmatter: Record<string, unknown> = {
      ...frontmatter,
      tags,
      provenance: {
        ...(frontmatter["provenance"] as Record<string, unknown> | undefined),
        tags: provRecord,
      },
    };

    return {
      aco: { frontmatter: updatedFrontmatter, body },
      fieldUpdated: this.field,
      confidence,
      model: provider.model,
    };
  }
}
