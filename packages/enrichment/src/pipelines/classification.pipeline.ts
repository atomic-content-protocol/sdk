import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type { EnrichmentOptions } from "./pipeline.interface.js";
import { SingleFieldPipeline, resolveModality, type GeneratedField } from "./single-field.pipeline.js";
import { buildClassificationPrompt } from "../utils/prompts.js";
import { completeWithModel } from "../utils/provider-meta.js";

export const VALID_CLASSIFICATIONS = [
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
  "image",
  "video",
  "audio",
  "other",
] as const;

export type Classification = (typeof VALID_CLASSIFICATIONS)[number];

function isValidClassification(value: string): value is Classification {
  return (VALID_CLASSIFICATIONS as readonly string[]).includes(value);
}

/**
 * ClassificationPipeline — classifies ACO content into a fixed taxonomy.
 *
 * Media ACOs (image / video source types) are classified deterministically
 * from their modality without an LLM call. Idempotent: leaves an existing
 * `classification` alone unless `force` is set.
 */
export class ClassificationPipeline extends SingleFieldPipeline<Classification> {
  readonly name = "classification";
  readonly field = "classification";

  protected async generate(
    aco: ACO,
    provider: IEnrichmentProvider,
    _options?: EnrichmentOptions
  ): Promise<GeneratedField<Classification> | null> {
    const modality = resolveModality(aco.frontmatter);
    if (modality === "image" || modality === "video") {
      return { value: modality, confidence: 1.0, model: "system" };
    }

    const title = String(aco.frontmatter["title"] ?? "");
    const { result, model } = await completeWithModel(
      provider,
      buildClassificationPrompt(title, aco.body, modality),
      { maxTokens: 20, temperature: 0.1 } // low temperature: deterministic classification
    );

    const raw = result.trim().toLowerCase().replace(/[^a-z\s]/g, "");
    const firstWord = raw.split(/\s+/)[0] ?? "";
    const classification: Classification = isValidClassification(raw)
      ? raw
      : isValidClassification(firstWord)
        ? firstWord
        : "other";

    return { value: classification, confidence: classification !== "other" ? 0.85 : 0.5, model };
  }
}
