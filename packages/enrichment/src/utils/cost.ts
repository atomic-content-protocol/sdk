import { approximateTokenCount } from '@acp/core';

// Model pricing per 1M tokens (as of 2026)
const PRICING = {
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
} as const;

// Estimated output tokens by depth
const OUTPUT_TOKENS = {
  basic: 150,
  standard: 300,
  deep: 500,
} as const;

// Estimated frontmatter size in tokens after enrichment
const FRONTMATTER_TOKENS = {
  basic: 120,
  standard: 200,
  deep: 350,
} as const;

// Cost per token for a reading model (GPT-4o rate for context input)
const READ_COST_PER_TOKEN = 2.50 / 1_000_000;

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: {
    'claude-haiku-4-5': number;
    'gpt-4o-mini': number;
  };
  frontmatterTokens: number;
  contentTokens: number;
  savingsPerRead: number;
  savingsPercent: number;
  breakEvenReads: number;
}

export function estimateEnrichmentCost(
  content: string,
  depth: 'basic' | 'standard' | 'deep' = 'standard'
): CostEstimate {
  const contentTokens = approximateTokenCount(content);
  const promptOverhead = 200; // system prompt + instructions
  const inputTokens = contentTokens + promptOverhead;
  const outputTokens = OUTPUT_TOKENS[depth];
  const totalTokens = inputTokens + outputTokens;
  const frontmatterTokens = FRONTMATTER_TOKENS[depth];

  const estimatedCost = {} as CostEstimate['estimatedCost'];
  for (const [model, rates] of Object.entries(PRICING)) {
    estimatedCost[model as keyof typeof PRICING] =
      (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  }

  const savingsPerRead = Math.max(0, contentTokens - frontmatterTokens);
  const savingsPercent = contentTokens > 0 ? (savingsPerRead / contentTokens) * 100 : 0;

  // Break-even: how many reads until the savings in read costs exceed the enrichment cost
  const savingsPerReadDollars = savingsPerRead * READ_COST_PER_TOKEN;
  const breakEvenReads = savingsPerReadDollars > 0
    ? Math.ceil(estimatedCost['claude-haiku-4-5'] / savingsPerReadDollars)
    : Infinity;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    frontmatterTokens,
    contentTokens,
    savingsPerRead,
    savingsPercent,
    breakEvenReads,
  };
}

export function formatCostEstimate(estimate: CostEstimate): string {
  const cost = estimate.estimatedCost['claude-haiku-4-5'];
  return [
    `Estimated cost: ~$${cost.toFixed(4)} (Claude Haiku)`,
    `Content: ${estimate.contentTokens.toLocaleString()} tokens → enriched frontmatter: ~${estimate.frontmatterTokens} tokens`,
    `Savings per future read: ${estimate.savingsPerRead.toLocaleString()} tokens (${estimate.savingsPercent.toFixed(0)}%)`,
    `Break-even: ${estimate.breakEvenReads === Infinity ? 'N/A' : estimate.breakEvenReads + ' reads'}`,
  ].join('\n');
}
