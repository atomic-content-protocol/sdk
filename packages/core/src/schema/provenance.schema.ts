import { z } from "zod";

/**
 * ProvenanceRecordSchema — tracks which model generated a specific field.
 *
 * Spec reference: §3.13
 * Required: model, timestamp. Optional: version, confidence.
 */
export const ProvenanceRecordSchema = z
  .object({
    /** Model identifier used for generation (e.g. "claude-haiku-4-5", "gpt-4o-mini"). */
    model: z.string(),
    /** Model version or checkpoint (e.g. "20251001", "2024-07-18"). */
    version: z.string().optional(),
    /** When the field was generated. ISO 8601 with timezone. */
    timestamp: z.string(),
    /**
     * Model's self-assessed confidence in the generated value (0.0–1.0).
     * This is NOT the same as ACO-level `confidence` (behavioral relevance).
     * See §3.12 and §3.13 for the distinction.
     */
    confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;

/**
 * ProvenanceMapSchema — the top-level `provenance` object on an ACO.
 *
 * Keys are field names on the ACO (e.g. "summary", "tags", "key_entities").
 * Values are ProvenanceRecord objects.
 *
 * A field with a provenance entry is machine-generated.
 * A field without one is human-authored.
 */
export const ProvenanceMapSchema = z
  .record(z.string(), ProvenanceRecordSchema)
  .describe(
    "Map of field name → provenance record. Keys are ACO field names. Presence of a key signals the field was machine-generated."
  );

export type ProvenanceMap = z.infer<typeof ProvenanceMapSchema>;
