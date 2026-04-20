import type { ProvenanceRecord } from "@atomic-content-protocol/core";

/**
 * Optional extras for createProvenanceRecord — `pipeline` and `tool` are
 * spec-defined optional fields (ACP §3.13) that help distinguish records
 * produced by different enrichment pipelines or different implementations.
 */
export interface ProvenanceOptions {
  /** Enrichment pipeline identifier, e.g. "unified", "tag-only". */
  pipeline?: string;
  /** Software that ran the enrichment, e.g. "@stacklist/mcp-server@2.0.0". */
  tool?: string;
}

/**
 * createProvenanceRecord — build a provenance record for an enriched field.
 *
 * @param model      The model identifier used for generation (e.g. "claude-haiku-4-5").
 * @param confidence The model's self-assessed confidence for this field (0.0–1.0).
 * @param options    Optional pipeline + tool identifiers (ACP §3.13).
 */
export function createProvenanceRecord(
  model: string,
  confidence: number,
  options?: ProvenanceOptions
): ProvenanceRecord {
  const record: ProvenanceRecord = {
    model,
    timestamp: new Date().toISOString(),
    confidence,
  };
  if (options?.pipeline) record.pipeline = options.pipeline;
  if (options?.tool) record.tool = options.tool;
  return record;
}
