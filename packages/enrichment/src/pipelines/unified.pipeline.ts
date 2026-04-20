import type { ACO } from "@atomic-content-protocol/core";
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
    const prompt = buildUnifiedPrompt(title, body);

    const output = await provider.structuredComplete<UnifiedEnrichmentOutput>(
      prompt,
      UNIFIED_SCHEMA,
      {
        maxTokens: 1_024,
        temperature: 0.3,
      }
    );

    const model = provider.model;

    const newProvenance: Record<string, unknown> = { ...existingProvenance };
    const updatedFields: Record<string, unknown> = { ...frontmatter };

    if (needsTags) {
      updatedFields["tags"] = output.tags;
      newProvenance["tags"] = createProvenanceRecord(model, 0.85, { pipeline: this.name, tool: options?.tool });
    }
    if (needsSummary) {
      updatedFields["summary"] = output.summary;
      newProvenance["summary"] = createProvenanceRecord(model, 0.85, { pipeline: this.name, tool: options?.tool });
    }
    if (needsClassification) {
      updatedFields["classification"] = output.classification;
      newProvenance["classification"] = createProvenanceRecord(model, 0.85, { pipeline: this.name, tool: options?.tool });
    }
    if (needsEntities) {
      updatedFields["key_entities"] = output.key_entities;
      newProvenance["key_entities"] = createProvenanceRecord(model, 0.80, { pipeline: this.name, tool: options?.tool });
    }
    if (needsLanguage && output.language) {
      updatedFields["language"] = output.language;
      newProvenance["language"] = createProvenanceRecord(model, 0.95, { pipeline: this.name, tool: options?.tool });
    }

    updatedFields["provenance"] = newProvenance;

    return {
      aco: { frontmatter: updatedFields, body },
      fieldUpdated: this.field,
      confidence: 0.85,
      model,
    };
  }
}
