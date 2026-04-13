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
 * The `approximate` field is always present. `cl100k` is populated when
 * the optional `tiktoken` package is installed; it uses the cl100k_base
 * encoding (gpt-4o / gpt-4 / gpt-3.5-turbo / text-embedding-ada-002).
 */
export interface TokenCounts {
  approximate: number;
  cl100k?: number;
  [key: string]: number | undefined;
}

/**
 * computeTokenCounts — returns token count estimates for the given text.
 *
 * Always returns the heuristic `approximate` count. If the optional
 * `tiktoken` package is installed, also populates `cl100k` using the
 * cl100k_base encoding (gpt-4o / gpt-4 family). Gracefully degrades if
 * tiktoken is absent or fails to load.
 */
export async function computeTokenCounts(text: string): Promise<TokenCounts> {
  const counts: TokenCounts = {
    approximate: approximateTokenCount(text),
  };

  // Try to load tiktoken (optional dependency — 4 MB WASM, not always present).
  const tiktoken = await import('tiktoken').catch(() => null);
  if (tiktoken) {
    try {
      const enc = tiktoken.encoding_for_model('gpt-4o');
      counts.cl100k = enc.encode(text).length;
      enc.free();
    } catch {
      // tiktoken loaded but encoding failed — skip cl100k, keep approximate.
    }
  }

  return counts;
}
