import type { ACO, SourceType } from "@atomic-content-protocol/core";
import {
  getEnrichmentStrategy,
  SOURCE_TYPE_MODALITY,
  SOURCE_TYPES,
} from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type {
  IEnrichmentPipeline,
  EnrichmentResult,
  EnrichmentOptions,
} from "./pipeline.interface.js";
import {
  buildUnifiedPrompt,
  UNIFIED_SCHEMA,
  type UnifiedEnrichmentOutput,
} from "../utils/prompts.js";
import { createProvenanceRecord } from "../utils/provenance.js";

/**
 * UnifiedPipeline — enriches tags, summary, classification, and key_entities
 * with a **single** LLM call using structured output.
 *
 * This is the preferred pipeline for most use cases: at ~$0.002/ACO it
 * replaces four separate calls with one structured completion.
 *
 * Per-field idempotency: fields that already have provenance are skipped
 * (the LLM still runs, but the field is not overwritten) unless `force` is true.
 * If ALL four fields already have provenance, the LLM call is skipped entirely.
 */
export class UnifiedPipeline implements IEnrichmentPipeline {
  readonly name = "unified";
  readonly field = "multiple";

  async enrich(
    aco: ACO,
    provider: IEnrichmentProvider,
    options?: EnrichmentOptions
  ): Promise<EnrichmentResult> {
    const { frontmatter, body } = aco;
    const existingProvenance = (
      frontmatter["provenance"] as Record<string, unknown> | undefined
    ) ?? {};

    // Determine which fields need enrichment
    const needsTags =
      !frontmatter["tags"] || !existingProvenance["tags"] || options?.force;
    const needsSummary =
      !frontmatter["summary"] ||
      !existingProvenance["summary"] ||
      options?.force;
    const needsClassification =
      !frontmatter["classification"] ||
      !existingProvenance["classification"] ||
      options?.force;
    const needsEntities =
      !frontmatter["key_entities"] ||
      !existingProvenance["key_entities"] ||
      options?.force;
    const needsLanguage =
      !frontmatter["language"] ||
      !existingProvenance["language"] ||
      options?.force;

    // Short-circuit if nothing to do
    if (
      !needsTags &&
      !needsSummary &&
      !needsClassification &&
      !needsEntities &&
      !needsLanguage
    ) {
      return {
        aco,
        fieldUpdated: this.field,
        confidence: 0,
        model: "skipped",
      };
    }

    const title = String(frontmatter["title"] ?? "");

    // Validate source_type at runtime — frontmatter is Record<string, unknown>
    // and the cast would crash getEnrichmentStrategy if an unknown value slipped in.
    const rawSourceType = frontmatter["source_type"] ?? "manual";
    const sourceType: SourceType = (SOURCE_TYPES as readonly string[]).includes(rawSourceType as string)
      ? (rawSourceType as SourceType)
      : "manual";

    const strategy = getEnrichmentStrategy(sourceType, body);
    const modality = SOURCE_TYPE_MODALITY[sourceType] ?? "text";

    const newProvenance: Record<string, unknown> = { ...existingProvenance };
    const updatedFields: Record<string, unknown> = { ...frontmatter };

    // Short-circuit: if the only field needing enrichment is classification AND
    // the strategy has a fixed default, skip the LLM call entirely.
    const llmNeededForTags = needsTags && strategy.textEnrichment;
    const llmNeededForSummary = needsSummary && strategy.summary;
    const llmNeededForEntities = needsEntities && strategy.textEnrichment;
    const llmNeededForLanguage = needsLanguage && strategy.language;
    const llmNeededForClassification = needsClassification && !strategy.classificationDefault;
    const needsLLM = llmNeededForTags || llmNeededForSummary || llmNeededForEntities ||
      llmNeededForLanguage || llmNeededForClassification;

    let model = "skipped";

    if (needsClassification && strategy.classificationDefault) {
      updatedFields["classification"] = strategy.classificationDefault;
      newProvenance["classification"] = createProvenanceRecord("system", 1.0, { pipeline: this.name, tool: options?.tool });
    }

    if (needsLLM) {
      const prompt = buildUnifiedPrompt(title, body, modality);
      const output = await provider.structuredComplete<UnifiedEnrichmentOutput>(
        prompt,
        UNIFIED_SCHEMA,
        { maxTokens: 1_024, temperature: 0.3 }
      );
      model = provider.model;

      if (llmNeededForTags) {
        updatedFields["tags"] = output.tags;
        newProvenance["tags"] = createProvenanceRecord(model, 0.85, { pipeline: this.name, tool: options?.tool });
      }
      if (llmNeededForSummary) {
        updatedFields["summary"] = output.summary;
        newProvenance["summary"] = createProvenanceRecord(model, 0.85, { pipeline: this.name, tool: options?.tool });
      }
      if (llmNeededForClassification) {
        updatedFields["classification"] = output.classification;
        newProvenance["classification"] = createProvenanceRecord(model, 0.85, { pipeline: this.name, tool: options?.tool });
      }
      if (llmNeededForEntities) {
        updatedFields["key_entities"] = output.key_entities;
        newProvenance["key_entities"] = createProvenanceRecord(model, 0.80, { pipeline: this.name, tool: options?.tool });
      }
      // Never write language inferred from a filename — only when strategy permits
      // it and the model returned a non-null value.
      if (llmNeededForLanguage && output.language) {
        updatedFields["language"] = output.language;
        newProvenance["language"] = createProvenanceRecord(model, 0.95, { pipeline: this.name, tool: options?.tool });
      }
    }

    updatedFields["provenance"] = newProvenance;

    return {
      aco: { frontmatter: updatedFields, body },
      fieldUpdated: this.field,
      confidence: needsLLM ? 0.85 : 1.0,
      model,
    };
  }
}
