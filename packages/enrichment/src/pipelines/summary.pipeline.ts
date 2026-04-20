import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type {
  IEnrichmentPipeline,
  EnrichmentResult,
  EnrichmentOptions,
} from "./pipeline.interface.js";
import { buildSummaryPrompt } from "../utils/prompts.js";
import { createProvenanceRecord } from "../utils/provenance.js";

/**
 * SummaryPipeline — generates a 2-sentence summary of ACO content.
 *
 * Idempotent: skips enrichment if `frontmatter.summary` and a provenance
 * record for "summary" already exist, unless `options.force` is true.
 */
export class SummaryPipeline implements IEnrichmentPipeline {
  readonly name = "summary";
  readonly field = "summary";

  async enrich(
    aco: ACO,
    provider: IEnrichmentProvider,
    options?: EnrichmentOptions
  ): Promise<EnrichmentResult> {
    const { frontmatter, body } = aco;

    // Idempotency check
    const existingSummary = frontmatter["summary"];
    const existingProvenance = (
      frontmatter["provenance"] as Record<string, unknown> | undefined
    )?.["summary"];
    if (existingSummary && existingProvenance && !options?.force) {
      return {
        aco,
        fieldUpdated: this.field,
        confidence: 0,
        model: "skipped",
      };
    }

    const title = String(frontmatter["title"] ?? "");
    const prompt = buildSummaryPrompt(title, body);

    const summary = await provider.complete(prompt, {
      maxTokens: 256,
      temperature: 0.3,
    });

    const trimmed = summary.trim();
    const confidence = trimmed.length > 0 ? 0.85 : 0.0;
    const provRecord = createProvenanceRecord(provider.model, confidence, {
      pipeline: this.name,
      tool: options?.tool,
    });

    const updatedFrontmatter: Record<string, unknown> = {
      ...frontmatter,
      summary: trimmed,
      provenance: {
        ...(frontmatter["provenance"] as Record<string, unknown> | undefined),
        summary: provRecord,
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
