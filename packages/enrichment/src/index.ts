/**
 * @acp/enrichment — LLM enrichment pipelines for the Atomic Content Protocol.
 *
 * Quick-start:
 *
 * ```typescript
 * import { ProviderRouter, UnifiedPipeline, BatchEnricher } from '@acp/enrichment';
 *
 * const router = ProviderRouter.fromConfig({
 *   anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
 *   openai:    { apiKey: process.env.OPENAI_API_KEY! },
 * });
 *
 * const enricher = new BatchEnricher(router, [new UnifiedPipeline()]);
 * const enriched = await enricher.enrichOne(myACO);
 * ```
 */

// Providers
export type {
  IEnrichmentProvider,
  CompletionOptions,
  StructuredSchema,
} from "./providers/index.js";
export { AnthropicProvider } from "./providers/index.js";
export { OpenAIProvider } from "./providers/index.js";
export { OllamaProvider } from "./providers/index.js";

// Router
export { CircuitBreaker, ProviderRouter } from "./router/index.js";
export type {
  CircuitBreakerOptions,
  ProviderConfig,
  RouterOptions,
  CompletionResponse,
  StructuredResponse,
  EmbedResponse,
} from "./router/index.js";

// Pipelines
export type {
  IEnrichmentPipeline,
  EnrichmentResult,
  EnrichmentOptions,
} from "./pipelines/index.js";
export {
  TagPipeline,
  SummaryPipeline,
  EntityPipeline,
  ClassificationPipeline,
  UnifiedPipeline,
} from "./pipelines/index.js";
export type { KeyEntity } from "./pipelines/index.js";

// Batch
export { BatchEnricher } from "./batch/index.js";

// Utilities
export {
  createProvenanceRecord,
  buildTagPrompt,
  buildSummaryPrompt,
  buildEntityPrompt,
  buildClassificationPrompt,
  buildUnifiedPrompt,
  UNIFIED_SCHEMA,
} from "./utils/index.js";
export type { UnifiedEnrichmentOutput } from "./utils/index.js";
