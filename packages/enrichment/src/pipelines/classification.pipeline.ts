import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type {
  IEnrichmentPipeline,
  EnrichmentResult,
  EnrichmentOptions,
} from "./pipeline.interface.js";
import { buildClassificationPrompt } from "../utils/prompts.js";
import { createProvenanceRecord } from "../utils/provenance.js";

const VALID_CLASSIFICATIONS = [
  "reference",
  "framework",
  "memo",
  "checklist",
  "notes",
  "transcript",
  "snippet",
  "code",
  "tutorial",
  "analysis",
  "other",
] as const;

type Classification = (typeof VALID_CLASSIFICATIONS)[number];

function isValidClassification(value: string): value is Classification {
  return (VALID_CLASSIFICATIONS as readonly string[]).includes(value);
}

/**
 * ClassificationPipeline — classifies ACO content into a fixed taxonomy.
 *
 * Idempotent: skips enrichment if `frontmatter.classification` and a provenance
 * record for "classification" already exist, unless `options.force` is true.
 */
export class ClassificationPipeline implements IEnrichmentPipeline {
  readonly name = "classification";
  readonly field = "classification";

  async enrich(
    aco: ACO,
    provider: IEnrichmentProvider,
    options?: EnrichmentOptions
  ): Promise<EnrichmentResult> {
    const { frontmatter, body } = aco;

    // Idempotency check
    const existing = frontmatter["classification"];
    const existingProvenance = (
      frontmatter["provenance"] as Record<string, unknown> | undefined
    )?.["classification"];
    if (existing && existingProvenance && !options?.force) {
      return {
        aco,
        fieldUpdated: this.field,
        confidence: 0,
        model: "skipped",
      };
    }

    const title = String(frontmatter["title"] ?? "");
    const prompt = buildClassificationPrompt(title, body);

    const response = await provider.complete(prompt, {
      maxTokens: 20,
      temperature: 0.1, // Low temperature: deterministic classification
    });

    // Extract just the classification word from the response
    const raw = response.trim().toLowerCase();
    // Try the whole response first, then the first word
    const classification: Classification = isValidClassification(raw)
      ? raw
      : isValidClassification(raw.split(/\s+/)[0] ?? "")
        ? (raw.split(/\s+/)[0] as Classification)
        : "other";

    const confidence = classification !== "other" ? 0.85 : 0.5;
    const provRecord = createProvenanceRecord(provider.model, confidence, {
      pipeline: this.name,
      tool: options?.tool,
    });

    const updatedFrontmatter: Record<string, unknown> = {
      ...frontmatter,
      classification,
      provenance: {
        ...(frontmatter["provenance"] as Record<string, unknown> | undefined),
        classification: provRecord,
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
