/**
 * Model catalogue — the single place that knows which model ids exist, what
 * they cost, and which request parameters they accept.
 *
 * Everything else in the package (providers, router, cost estimator, CLI)
 * reads from here so a model refresh is a one-file change.
 */

/** Coarse quality tiers exposed to callers instead of raw model ids. */
export type QualityTier = "fast" | "balanced" | "best";

export const QUALITY_TIERS: readonly QualityTier[] = ["fast", "balanced", "best"];

export const DEFAULT_QUALITY: QualityTier = "fast";

/**
 * Default model per provider and tier.
 *
 * "fast" is the right default for enrichment: tag / summary / entity /
 * classification extraction over a few thousand characters is a small-model
 * task, and the fast tier is roughly 5x cheaper than "best".
 */
export const MODEL_PRESETS: Record<QualityTier, { anthropic: string; openai: string }> = {
  fast: { anthropic: "claude-haiku-4-5", openai: "gpt-5.6-luna" },
  balanced: { anthropic: "claude-sonnet-5", openai: "gpt-5.6-terra" },
  best: { anthropic: "claude-opus-5", openai: "gpt-5.6-sol" },
};

/** Default embedding models. Ollama defaults to the chat model unless overridden. */
export const DEFAULT_EMBEDDING_MODELS = {
  openai: "text-embedding-3-small",
} as const;

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

/**
 * List prices per 1M tokens, first-party API rates, verified 2026-09.
 * Anthropic: https://www.anthropic.com/pricing — OpenAI: https://openai.com/api/pricing
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
  // OpenAI
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.6-terra": { input: 2.0, output: 12.0 },
  "gpt-5.6-sol": { input: 4.0, output: 20.0 },
  // Embeddings (output is n/a; kept 0 for uniform arithmetic)
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

/** Price lookup that tolerates dated suffixes (e.g. "claude-haiku-4-5-20251001"). */
export function pricingFor(model: string): ModelPricing | undefined {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  const base = Object.keys(MODEL_PRICING).find((known) => model.startsWith(known));
  return base ? MODEL_PRICING[base] : undefined;
}

/**
 * Whether an Anthropic model accepts `temperature` / `top_p` / `top_k`.
 * Sampling parameters were removed on Claude 4.7+ and the Claude 5 family
 * (the API returns 400 if they are sent). Haiku 4.5 and the 4.6 line accept them.
 */
export function anthropicSupportsSampling(model: string): boolean {
  return /^claude-(haiku-4-5|sonnet-4-6|opus-4-6|opus-4-5|sonnet-4-5|3-)/.test(model);
}

/**
 * Whether an OpenAI model is a reasoning model. Reasoning models (o-series,
 * gpt-5 family) reject `temperature` other than the default and require
 * `max_completion_tokens` rather than the deprecated `max_tokens`.
 */
export function openaiIsReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5|gpt-6)/.test(model);
}
