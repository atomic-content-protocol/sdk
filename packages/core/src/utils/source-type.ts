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
 * EnrichmentStrategy: per-field enrichment contract for a given modality.
 *
 * Each base boolean (`language`, `summary`, `textEnrichment`) indicates
 * whether a pipeline MAY run inference for that field. A false value means
 * the field MUST NOT be inferred from the body (it either has no body, or the
 * body is not reliable signal for that field).
 *
 * `classificationDefault`:
 *   - null  → pipeline should infer from body content.
 *   - string → pipeline should set this value without running inference.
 *
 * `languageConditional` / `summaryConditional` / `textEnrichmentConditional`:
 *   true gates the matching base flag on the body. The field may then be
 *   inferred ONLY IF the base flag is true AND the trimmed body is at least
 *   MIN_BODY_LENGTH_FOR_ENRICHMENT characters long. A conditional flag never
 *   enables a field whose base flag is false. `getEnrichmentStrategy` applies
 *   this rule; pipelines MUST go through it rather than read the table.
 */
export interface EnrichmentStrategy {
  /** Whether language detection may run against the body. */
  language: boolean;
  /** Whether `language` is additionally gated on the body meeting the length threshold. */
  languageConditional: boolean;
  /** null = infer; string = use as fixed default, skip inference. */
  classificationDefault: string | null;
  /** Whether a summary may be generated from the body. */
  summary: boolean;
  /** Whether `summary` is additionally gated on the body meeting the length threshold. */
  summaryConditional: boolean;
  /** Whether key_entities and tags may be inferred from the body. */
  textEnrichment: boolean;
  /** Whether `textEnrichment` is additionally gated on the body meeting the length threshold. */
  textEnrichmentConditional: boolean;
}

/**
 * Enrichment strategy per ContentModality.
 *
 * "text" enables every field but gates each on body length. A body under
 * MIN_BODY_LENGTH_FOR_ENRICHMENT characters (empty, or a placeholder such as
 * "TODO") carries no signal of its own, and a model handed only the title
 * writes a confident summary from the title alone. Such a body therefore gets
 * no summary, tags, key_entities or language from inference.
 *
 * "document" is identical to "text": once a PDF/Doc has been extracted to
 * plain text the body is treated the same as any other text ACO.
 *
 * "video" is gated the same way because converted_video ACOs may carry a
 * full transcript (body = text) or no transcript at all (body = ""). Its
 * classification is fixed either way.
 *
 * @important Do not read this table directly in pipeline code. Use
 * `getEnrichmentStrategy(sourceType, body)` instead: it resolves conditional
 * flags and applies the body-length threshold automatically.
 */
export const MODALITY_ENRICHMENT: Record<ContentModality, EnrichmentStrategy> = {
  text: {
    language: true,
    languageConditional: true, // only if the body meets the length threshold
    classificationDefault: null,
    summary: true,
    summaryConditional: true, // only if the body meets the length threshold
    textEnrichment: true,
    textEnrichmentConditional: true, // only if the body meets the length threshold
  },
  document: {
    language: true,
    languageConditional: true, // only if the body meets the length threshold
    classificationDefault: null,
    summary: true,
    summaryConditional: true, // only if the body meets the length threshold
    textEnrichment: true,
    textEnrichmentConditional: true, // only if the body meets the length threshold
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
    language: true,
    languageConditional: true, // only if a transcript body is present
    classificationDefault: "video",
    summary: true,
    summaryConditional: true, // only if a transcript body is present
    textEnrichment: true,
    textEnrichmentConditional: true, // only if a transcript body is present
  },
};

/** Minimum trimmed body length (characters) for conditional enrichment to run. */
export const MIN_BODY_LENGTH_FOR_ENRICHMENT = 50;

/**
 * getEnrichmentStrategy: resolve the concrete enrichment strategy for a
 * given source_type and body string.
 *
 * A conditional flag gates its base flag on the body: the resolved field is
 * true when the base flag is true and either the flag is unconditional or the
 * trimmed body is at least MIN_BODY_LENGTH_FOR_ENRICHMENT characters. A text
 * ACO with a ten-character placeholder body and a video without a transcript
 * therefore both resolve to no summary, no tags or entities and no language.
 * `classificationDefault` passes through unchanged.
 *
 * @param sourceType  The ACO's source_type value.
 * @param body        The ACO's content body (may be empty string).
 * @returns           A resolved EnrichmentStrategy with no conditional flags.
 */
export function getEnrichmentStrategy(
  sourceType: SourceType,
  body: string
): Omit<EnrichmentStrategy, "languageConditional" | "summaryConditional" | "textEnrichmentConditional"> {
  // Defensive fallback: unknown source_type values (e.g. from future spec versions
  // or malformed frontmatter) default to "text" enrichment rather than crashing.
  const modality = SOURCE_TYPE_MODALITY[sourceType] ?? "text";
  const base = MODALITY_ENRICHMENT[modality];
  const hasBody = body.trim().length >= MIN_BODY_LENGTH_FOR_ENRICHMENT;
  const resolve = (enabled: boolean, conditional: boolean): boolean => enabled && (!conditional || hasBody);

  return {
    language: resolve(base.language, base.languageConditional),
    classificationDefault: base.classificationDefault,
    summary: resolve(base.summary, base.summaryConditional),
    textEnrichment: resolve(base.textEnrichment, base.textEnrichmentConditional),
  };
}
