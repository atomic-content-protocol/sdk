import type { SourceType } from "../schema/aco.schema.js";

/**
 * Content modality — the primary medium of an ACO's body.
 *
 * "text"     — body is readable prose/markup (all standard text source types).
 * "document" — body is extracted text from a binary format (PDF, Word).
 *              Enrichment is the same as "text", but the body MAY be noisier.
 * "image"    — body is absent or filename-only; content lives in a binary file.
 * "video"    — body is absent OR a transcript; content MAY be a binary file.
 */
export type ContentModality = "text" | "document" | "image" | "video";

/**
 * Maps every SourceType to its ContentModality.
 * Used by enrichment pipelines to select the correct strategy without
 * per-source-type conditionals scattered across the codebase.
 */
export const SOURCE_TYPE_MODALITY: Record<SourceType, ContentModality> = {
  link: "text",
  uploaded_md: "text",
  manual: "text",
  selected_text: "text",
  llm_capture: "text",
  converted_pdf: "document",
  converted_doc: "document",
  uploaded_image: "image",
  converted_video: "video",
};

/**
 * EnrichmentStrategy — per-field enrichment contract for a given modality.
 *
 * Each boolean indicates whether a pipeline MAY run inference for that field.
 * A false value means the field MUST NOT be inferred from the body (it either
 * has no body, or the body is not reliable signal for that field).
 *
 * `classificationDefault`:
 *   - null  → pipeline should infer from body content.
 *   - string → pipeline should set this value without running inference.
 *
 * `summaryConditional` / `languageConditional`:
 *   true means the field may be inferred ONLY IF the body is non-empty
 *   and passes a minimum length threshold (recommended: ≥ 50 chars).
 *   Pipelines MUST check body length before running inference for these.
 */
export interface EnrichmentStrategy {
  /** Whether language detection may run against the body. */
  language: boolean;
  /** Whether language inference is gated on body content being present. */
  languageConditional: boolean;
  /** null = infer; string = use as fixed default, skip inference. */
  classificationDefault: string | null;
  /** Whether a summary may be generated from the body. */
  summary: boolean;
  /** Whether summary generation is gated on body content being present. */
  summaryConditional: boolean;
  /** Whether key_entities and tags may be inferred from the body. */
  textEnrichment: boolean;
  /** Whether textEnrichment is gated on body content being present. */
  textEnrichmentConditional: boolean;
}

/**
 * Enrichment strategy per ContentModality.
 *
 * "document" is identical to "text" — once a PDF/Doc has been extracted to
 * plain text the body is treated the same as any other text ACO.
 *
 * "video" uses conditional flags throughout because converted_video ACOs may
 * carry a full transcript (body = text) or no transcript at all (body = "").
 * Pipelines must inspect body length before running any inference.
 */
export const MODALITY_ENRICHMENT: Record<ContentModality, EnrichmentStrategy> =
  {
    text: {
      language: true,
      languageConditional: false,
      classificationDefault: null,
      summary: true,
      summaryConditional: false,
      textEnrichment: true,
      textEnrichmentConditional: false,
    },
    document: {
      language: true,
      languageConditional: false,
      classificationDefault: null,
      summary: true,
      summaryConditional: false,
      textEnrichment: true,
      textEnrichmentConditional: false,
    },
    image: {
      language: false,
      languageConditional: false,
      classificationDefault: "image",
      summary: false,
      summaryConditional: false,
      textEnrichment: false,
      textEnrichmentConditional: false,
    },
    video: {
      language: false,
      languageConditional: true,   // only if transcript body is present
      classificationDefault: "video",
      summary: false,
      summaryConditional: true,    // only if transcript body is present
      textEnrichment: false,
      textEnrichmentConditional: true, // only if transcript body is present
    },
  };

/** Minimum body length (characters) for conditional enrichment to run. */
export const MIN_BODY_LENGTH_FOR_ENRICHMENT = 50;

/**
 * getEnrichmentStrategy — resolve the concrete enrichment strategy for a
 * given source_type and body string.
 *
 * Handles the conditional cases for "video" automatically: if the body meets
 * the minimum length threshold the conditional flags are promoted to true.
 *
 * @param sourceType  The ACO's source_type value.
 * @param body        The ACO's content body (may be empty string).
 * @returns           A resolved EnrichmentStrategy with no conditional flags.
 */
export function getEnrichmentStrategy(
  sourceType: SourceType,
  body: string
): Omit<
  EnrichmentStrategy,
  | "languageConditional"
  | "summaryConditional"
  | "textEnrichmentConditional"
> {
  // Defensive fallback: unknown source_type values (e.g. from future spec versions
  // or malformed frontmatter) default to "text" enrichment rather than crashing.
  const modality = SOURCE_TYPE_MODALITY[sourceType] ?? "text";
  const base = MODALITY_ENRICHMENT[modality];
  const hasBody = body.trim().length >= MIN_BODY_LENGTH_FOR_ENRICHMENT;

  return {
    language: base.language || (base.languageConditional && hasBody),
    classificationDefault: base.classificationDefault,
    summary: base.summary || (base.summaryConditional && hasBody),
    textEnrichment:
      base.textEnrichment || (base.textEnrichmentConditional && hasBody),
  };
}
