import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";

export type { IEnrichmentProvider };

/**
 * EnrichmentResult — returned by every pipeline after a successful run.
 */
export interface EnrichmentResult {
  /** The updated ACO with enriched fields written into `frontmatter`. */
  aco: ACO;
  /** The frontmatter field (or "multiple") that was updated. */
  fieldUpdated: string;
  /** Model-assessed confidence for the generated value (0.0–1.0). */
  confidence: number;
  /** Model identifier that produced this enrichment (e.g. "gpt-4o-mini"). */
  model: string;
  /** Approximate tokens consumed, if the provider reported it. */
  tokensUsed?: number;
  /**
   * Vector embedding produced by EmbedPipeline.
   * Not written to frontmatter (too large for YAML); returned here for
   * callers that need to store it in a vector database or cache it separately.
   */
  embedding?: number[];
}

/**
 * EnrichmentOptions — controls idempotency, force-overwrite, and provenance
 * metadata attribution.
 */
export interface EnrichmentOptions {
  /**
   * When true, regenerate the field even if a provenance record already exists.
   * Default: false (skip fields that have been previously enriched).
   */
  force?: boolean;
  /**
   * Identifier of the software calling the pipeline, stamped into each
   * provenance record's `tool` field. ACP §3.13.
   *
   * Recommended format: "<package-name>@<version>".
   * Examples: "acp-hosted-mcp@0.1.1", "@stacklist/mcp-server@2.0.0".
   */
  tool?: string;
}

/**
 * IEnrichmentPipeline — uniform interface for all enrichment pipeline steps.
 *
 * A pipeline is responsible for a single enrichment concern (tags, summary,
 * entities, etc.). It receives an ACO and a provider, runs the LLM call, and
 * returns a new ACO with the enriched field written back into `frontmatter`.
 */
export interface IEnrichmentPipeline {
  /** Human-readable pipeline name (e.g. "tag", "summary"). */
  readonly name: string;
  /** The frontmatter field this pipeline targets (e.g. "tags", "summary"). */
  readonly field: string;

  enrich(
    aco: ACO,
    provider: IEnrichmentProvider,
    options?: EnrichmentOptions
  ): Promise<EnrichmentResult>;
}
