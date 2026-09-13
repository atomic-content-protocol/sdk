import { approximateTokenCount } from "@atomic-content-protocol/core";
import { MODEL_PRESETS, MODEL_PRICING, pricingFor, type QualityTier } from "../providers/models.js";

export type EnrichmentDepth = "basic" | "standard" | "deep";

// Estimated output tokens by depth
const OUTPUT_TOKENS: Record<EnrichmentDepth, number> = {
  basic: 150,
  standard: 300,
  deep: 500,
};

// Estimated frontmatter size in tokens after enrichment
const FRONTMATTER_TOKENS: Record<EnrichmentDepth, number> = {
  basic: 120,
  standard: 200,
  deep: 350,
};

/**
 * Body characters actually sent to the model. Pipelines truncate to ~4 000
 * characters (see `buildUnifiedPrompt`), so estimating on the full document
 * would overstate input cost for long content.
 */
const MAX_PROMPT_BODY_CHARS = 4_000;

/** Prompt scaffolding (instructions + schema) in tokens. */
const PROMPT_OVERHEAD_TOKENS = 350;

/**
 * Cost per token of the model that will later *read* the ACO. Used only for
 * the break-even calculation. Sonnet-class input rate.
 */
const READ_COST_PER_TOKEN = MODEL_PRICING["claude-sonnet-5"]!.input / 1_000_000;

/** Model whose price headlines the estimate. */
export const DEFAULT_ESTIMATE_MODEL = MODEL_PRESETS.fast.anthropic;

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /**
   * Estimated USD cost per known model id. Always contains the six preset
   * models plus `model` when a custom one was requested and is priced.
   */
  estimatedCost: Record<string, number>;
  /** The model whose cost is reported in `cost`. */
  model: string;
  /** Estimated USD cost for `model`. */
  cost: number;
  frontmatterTokens: number;
  contentTokens: number;
  savingsPerRead: number;
  savingsPercent: number;
  breakEvenReads: number;
}

export interface CostEstimateOptions {
  /** Model to headline. Default: the `fast` Anthropic preset. */
  model?: string;
  /** Alternatively pick the headline model by tier (Anthropic side). */
  quality?: QualityTier;
}

/**
 * Estimate the cost of enriching `content` with the unified pipeline.
 *
 * @param content  ACO body text.
 * @param depth    Output verbosity preset; affects output-token and frontmatter estimates.
 * @param options  Which model to headline (`model` beats `quality`).
 */
export function estimateEnrichmentCost(
  content: string,
  depth: EnrichmentDepth = "standard",
  options: CostEstimateOptions = {}
): CostEstimate {
  const contentTokens = approximateTokenCount(content);
  const promptedTokens = approximateTokenCount(content.slice(0, MAX_PROMPT_BODY_CHARS));
  const inputTokens = promptedTokens + PROMPT_OVERHEAD_TOKENS;
  const outputTokens = OUTPUT_TOKENS[depth];
  const totalTokens = inputTokens + outputTokens;
  const frontmatterTokens = FRONTMATTER_TOKENS[depth];

  const headline =
    options.model ?? (options.quality ? MODEL_PRESETS[options.quality].anthropic : DEFAULT_ESTIMATE_MODEL);

  const models = new Set<string>([
    ...Object.values(MODEL_PRESETS).flatMap((p) => [p.anthropic, p.openai]),
    headline,
  ]);

  const estimatedCost: Record<string, number> = {};
  for (const model of models) {
    const rates = pricingFor(model);
    if (!rates) continue;
    estimatedCost[model] = (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  }

  const cost = estimatedCost[headline] ?? estimatedCost[DEFAULT_ESTIMATE_MODEL] ?? 0;

  const savingsPerRead = Math.max(0, contentTokens - frontmatterTokens);
  const savingsPercent = contentTokens > 0 ? (savingsPerRead / contentTokens) * 100 : 0;

  // Break-even: how many reads until the savings in read costs exceed the enrichment cost
  const savingsPerReadDollars = savingsPerRead * READ_COST_PER_TOKEN;
  const breakEvenReads =
    savingsPerReadDollars > 0 ? Math.ceil(cost / savingsPerReadDollars) : Infinity;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    model: headline,
    cost,
    frontmatterTokens,
    contentTokens,
    savingsPerRead,
    savingsPercent,
    breakEvenReads,
  };
}

export function formatCostEstimate(estimate: CostEstimate): string {
  return [
    `Estimated cost: ~$${estimate.cost.toFixed(4)} (${estimate.model})`,
    `Content: ${estimate.contentTokens.toLocaleString()} tokens → enriched frontmatter: ~${estimate.frontmatterTokens} tokens`,
    `Savings per future read: ${estimate.savingsPerRead.toLocaleString()} tokens (${estimate.savingsPercent.toFixed(0)}%)`,
    `Break-even: ${estimate.breakEvenReads === Infinity ? "N/A" : estimate.breakEvenReads + " reads"}`,
  ].join("\n");
}
