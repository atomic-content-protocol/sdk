import type { IStorageAdapter } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "@atomic-content-protocol/enrichment";

/**
 * ToolContext — everything a tool factory needs, built once per server.
 *
 * The enrichment provider is created lazily and shared across all tools so
 * circuit-breaker state and provider clients persist between calls instead
 * of being rebuilt on every invocation.
 */
export interface ToolContext {
  storage: IStorageAdapter;
  /** True when an enrichment provider is configured. */
  hasEnrichment: boolean;
  /** Shared enrichment provider. Throws `EnrichmentNotConfiguredError` when none is configured. */
  getProvider(): IEnrichmentProvider;
  /** ACP §3.13 `tool` identifier stamped into provenance. */
  toolId: string;
}

export class EnrichmentNotConfiguredError extends Error {
  constructor(tool: string) {
    super(`${tool} requires enrichment providers to be configured in ACPMCPServerConfig.enrichment`);
    this.name = "EnrichmentNotConfiguredError";
  }
}

/** Uniform error → ToolOutput mapping used by every tool. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
