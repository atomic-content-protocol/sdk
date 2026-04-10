/**
 * approximateTokenCount — simple heuristic token estimator.
 *
 * Uses the widely-cited rule of thumb that one token is approximately
 * four characters for English prose. This is intentionally model-agnostic.
 *
 * The spec (§3.7) notes 20%+ divergence between tokenizers, so this value
 * should only be used for rough sizing and display — not for billing or
 * context-window calculations. Use model-specific counts from `cl100k` or
 * `claude` fields in `token_counts` when precision is required.
 */
export function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * TokenCounts — shape of the object returned by computeTokenCounts.
 *
 * The `approximate` field is always present. Additional per-tokenizer
 * keys (e.g. `cl100k`, `claude`) can be added by callers or by future
 * versions of this function that integrate tiktoken or equivalent.
 */
export interface TokenCounts {
  approximate: number;
  [key: string]: number;
}

/**
 * computeTokenCounts — returns token count estimates for the given text.
 *
 * Currently returns only the heuristic approximation. Extend this function
 * to populate `cl100k` / `claude` keys when tiktoken or Anthropic's tokenizer
 * is available in the runtime environment.
 */
export function computeTokenCounts(text: string): TokenCounts {
  return {
    approximate: approximateTokenCount(text),
  };
}
