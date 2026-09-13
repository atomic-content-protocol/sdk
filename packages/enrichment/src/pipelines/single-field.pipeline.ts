import type { ACO, SourceType } from "@atomic-content-protocol/core";
import { type ContentModality, SOURCE_TYPE_MODALITY, SOURCE_TYPES } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import { createProvenanceRecord } from "../utils/provenance.js";
import type { EnrichmentOptions, EnrichmentResult, IEnrichmentPipeline } from "./pipeline.interface.js";

/**
 * Whether a frontmatter value counts as "present" for idempotency purposes.
 * Empty strings, empty arrays and empty objects do not: an empty enrichment
 * result is worth retrying, and a missing field must be filled in.
 */
export function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

/** Read the provenance map from frontmatter, tolerating any shape. */
export function readProvenance(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const p = frontmatter["provenance"];
  return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

/** Resolve the ACO's content modality from its `source_type`. */
export function resolveModality(frontmatter: Record<string, unknown>): ContentModality {
  const raw = frontmatter["source_type"];
  const sourceType: SourceType = (SOURCE_TYPES as readonly string[]).includes(String(raw))
    ? (raw as SourceType)
    : "manual";
  return SOURCE_TYPE_MODALITY[sourceType] ?? "text";
}

/**
 * Extract the first JSON array from free-form model output. Handles fenced
 * code blocks and surrounding prose; tolerant of `]` inside strings by trying
 * successive closing brackets until one parses.
 */
export function extractJsonArray(text: string): unknown[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("[");
  if (start === -1) return null;
  let end = cleaned.indexOf("]", start);
  while (end !== -1) {
    try {
      const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      end = cleaned.indexOf("]", end + 1);
    }
  }
  return null;
}

/** Outcome of a single-field generation step. */
export interface GeneratedField<T> {
  value: T;
  confidence: number;
  /** Model that produced the value (after router fallback). */
  model: string;
}

/**
 * SingleFieldPipeline — shared skeleton for pipelines that fill exactly one
 * frontmatter field with one LLM call.
 *
 * Idempotency contract (identical across all subclasses):
 *   - If the field already has a non-empty value, it is left untouched unless
 *     `options.force` is set. A value without a provenance record is treated
 *     as human-authored and is never overwritten implicitly.
 *   - If generation fails to yield a usable value, the ACO is returned
 *     unchanged and **no provenance record is written**, so the next run
 *     retries instead of skipping forever.
 */
export abstract class SingleFieldPipeline<T> implements IEnrichmentPipeline {
  abstract readonly name: string;
  abstract readonly field: string;

  /**
   * Produce the field value. Return `null` when the model output is unusable.
   * Implementations should use `utils/provider-meta.ts` so `model` reflects
   * the provider that actually answered.
   */
  protected abstract generate(
    aco: ACO,
    provider: IEnrichmentProvider,
    options?: EnrichmentOptions
  ): Promise<GeneratedField<T> | null>;

  async enrich(aco: ACO, provider: IEnrichmentProvider, options?: EnrichmentOptions): Promise<EnrichmentResult> {
    const { frontmatter, body } = aco;

    if (!options?.force && hasValue(frontmatter[this.field])) {
      return { aco, fieldUpdated: this.field, confidence: 0, model: "skipped" };
    }

    const generated = await this.generate(aco, provider, options);
    if (generated === null) {
      return { aco, fieldUpdated: this.field, confidence: 0, model: provider.model };
    }

    const provRecord = createProvenanceRecord(generated.model, generated.confidence, {
      pipeline: this.name,
      tool: options?.tool,
    });

    const updatedFrontmatter: Record<string, unknown> = {
      ...frontmatter,
      [this.field]: generated.value,
      provenance: { ...readProvenance(frontmatter), [this.field]: provRecord },
    };

    return {
      aco: { frontmatter: updatedFrontmatter, body },
      fieldUpdated: this.field,
      confidence: generated.confidence,
      model: generated.model,
    };
  }
}
