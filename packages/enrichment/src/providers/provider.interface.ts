/**
 * Core interfaces for enrichment providers.
 *
 * A provider wraps a single LLM API (Anthropic, OpenAI, Ollama, etc.) and
 * exposes a uniform interface for text completion, structured output, and
 * optional embedding / token-counting capabilities.
 */

export interface CompletionOptions {
  maxTokens?: number;
  /**
   * Sampling temperature. Providers silently omit it for models that reject
   * sampling parameters (Claude 5 family, OpenAI reasoning models).
   */
  temperature?: number;
  systemPrompt?: string;
  /**
   * Abort signal for the underlying HTTP request. The `ProviderRouter` wires
   * its circuit-breaker timeout to this so a timed-out request is actually
   * cancelled instead of continuing to spend tokens in the background.
   */
  signal?: AbortSignal;
}

export interface StructuredSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * IEnrichmentProvider — uniform interface for all LLM providers.
 *
 * Implementations must supply `complete` and `structuredComplete`.
 * `embed` and `countTokens` are optional capabilities.
 */
export interface IEnrichmentProvider {
  readonly name: string;
  readonly model: string;
  /** Model used by `embed()`, when the provider supports embeddings. */
  readonly embeddingModel?: string;

  /** Generate free-form text completion. */
  complete(prompt: string, options?: CompletionOptions): Promise<string>;

  /**
   * Generate structured output matching the given JSON-Schema-like schema.
   * Providers return the parsed JSON as-is; callers are responsible for
   * validating it (see the Zod schemas in `utils/prompts.ts`).
   */
  structuredComplete<T>(prompt: string, schema: StructuredSchema, options?: CompletionOptions): Promise<T>;

  /** Generate a vector embedding for the given text. Optional capability. */
  embed?(text: string, options?: { signal?: AbortSignal }): Promise<number[]>;

  /** Count tokens in the given text using the provider's tokeniser. Optional. */
  countTokens?(text: string): Promise<number>;

  // ---------------------------------------------------------------------------
  // Optional "with meta" variants — implemented by composite providers such as
  // `ProviderRouter` so callers learn which underlying provider/model answered.
  // Pipelines use `utils/provider-meta.ts`, which falls back to `model` above.
  // ---------------------------------------------------------------------------

  completeWithMeta?(
    prompt: string,
    options?: CompletionOptions
  ): Promise<{ result: string; provider: string; model: string }>;

  structuredCompleteWithMeta?<T>(
    prompt: string,
    schema: StructuredSchema,
    options?: CompletionOptions
  ): Promise<{ result: T; provider: string; model: string }>;

  embedWithMeta?(
    text: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ result: number[]; provider: string; model: string }>;
}
