import type { ProvenanceRecord } from "@acp/core";

/**
 * createProvenanceRecord — build a provenance record for an enriched field.
 *
 * @param model      The model identifier used for generation (e.g. "claude-haiku-4-5").
 * @param confidence The model's self-assessed confidence for this field (0.0–1.0).
 */
export function createProvenanceRecord(
  model: string,
  confidence: number
): ProvenanceRecord {
  return {
    model,
    timestamp: new Date().toISOString(),
    confidence,
  };
}
