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
 * encoding (GPT-4 / GPT-3.5-turbo / text-embedding-3-*). Note that GPT-4o
 * and later use o200k_base, which is a different tokenizer.
 */
export interface TokenCounts {
  approximate: number;
  cl100k?: number;
  [key: string]: number | undefined;
}

interface Tiktoken {
  encode(text: string): Uint32Array | number[];
}

interface TiktokenModule {
  get_encoding(name: "cl100k_base"): Tiktoken;
}

/**
 * Lazily-initialised cl100k_base encoder. tiktoken boots a WASM module and
 * building an encoder costs tens of milliseconds, so we create it once per
 * process and never free it. `null` means tiktoken is unavailable.
 */
let encoderPromise: Promise<Tiktoken | null> | undefined;

function getEncoder(): Promise<Tiktoken | null> {
  if (encoderPromise === undefined) {
    // Variable specifier keeps bundlers from trying to resolve the optional
    // dependency at build time.
    const specifier = "tiktoken";
    encoderPromise = import(specifier)
      .then((mod: TiktokenModule) => mod.get_encoding("cl100k_base"))
      .catch(() => null);
  }
  return encoderPromise;
}

/**
 * computeTokenCounts — returns token count estimates for the given text.
 *
 * Always returns the heuristic `approximate` count. If the optional
 * `tiktoken` package is installed, also populates `cl100k` using the
 * cl100k_base encoding. Gracefully degrades if tiktoken is absent or fails
 * to load.
 */
export async function computeTokenCounts(text: string): Promise<TokenCounts> {
  const counts: TokenCounts = {
    approximate: approximateTokenCount(text),
  };

  const encoder = await getEncoder();
  if (encoder) {
    try {
      counts.cl100k = encoder.encode(text).length;
    } catch {
      // Encoding failed for this input — keep approximate only.
    }
  }

  return counts;
}
