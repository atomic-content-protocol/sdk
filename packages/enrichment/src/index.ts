/**
 * @atomic-content-protocol/enrichment — LLM enrichment pipelines for the Atomic Content Protocol.
 *
 * Quick-start:
 *
 * ```typescript
 * import { ProviderRouter, UnifiedPipeline, BatchEnricher } from '@atomic-content-protocol/enrichment';
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

export type { BatchOptions, BatchResult } from "./batch/index.js";
// Batch
export { BatchEnricher } from "./batch/index.js";
// Pipelines
export type {
  Classification,
  EnrichmentOptions,
  EnrichmentResult,
  GeneratedField,
  IEnrichmentPipeline,
  KeyEntity,
} from "./pipelines/index.js";
export {
  ClassificationPipeline,
  EmbedPipeline,
  ENTITY_TYPES,
  EntityPipeline,
  extractJsonArray,
  hasValue,
  SingleFieldPipeline,
  SummaryPipeline,
  TagPipeline,
  UnifiedPipeline,
  VALID_CLASSIFICATIONS,
} from "./pipelines/index.js";
// Providers
export type {
  AnthropicProviderOptions,
  CompletionOptions,
  IEnrichmentProvider,
  ModelPricing,
  OllamaProviderOptions,
  OpenAIProviderOptions,
  QualityTier,
  StructuredSchema,
} from "./providers/index.js";
// Model catalogue
export {
  AnthropicProvider,
  DEFAULT_EMBEDDING_MODELS,
  DEFAULT_QUALITY,
  MODEL_PRESETS,
  MODEL_PRICING,
  OllamaProvider,
  OpenAIProvider,
  pricingFor,
  QUALITY_TIERS,
} from "./providers/index.js";
export type {
  CircuitBreakerOptions,
  CircuitState,
  CompletionResponse,
  EmbedResponse,
  ProviderConfig,
  RouterOptions,
  StructuredResponse,
} from "./router/index.js";
// Router
export { CircuitBreaker, CircuitOpenError, CircuitTimeoutError, ProviderRouter } from "./router/index.js";
export type {
  CostEstimate,
  CostEstimateOptions,
  EnrichmentDepth,
  UnifiedEnrichmentOutput,
} from "./utils/index.js";
export {
  buildClassificationPrompt,
  buildEntityPrompt,
  buildSummaryPrompt,
  buildTagPrompt,
  buildUnifiedPrompt,
  createProvenanceRecord,
  DEFAULT_ESTIMATE_MODEL,
  estimateEnrichmentCost,
  formatCostEstimate,
  parseUnifiedOutput,
  UNIFIED_SCHEMA,
  UnifiedOutputSchema,
} from "./utils/index.js";
// Utilities
export {
  completeWithModel,
  embedWithModel,
  structuredCompleteWithModel,
} from "./utils/provider-meta.js";
