/**
 * Core interfaces for enrichment providers.
 *
 * A provider wraps a single LLM API (Anthropic, OpenAI, Ollama, etc.) and
 * exposes a uniform interface for text completion, structured output, and
 * optional embedding / token-counting capabilities.
 */

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
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

  /** Generate free-form text completion. */
  complete(prompt: string, options?: CompletionOptions): Promise<string>;

  /** Generate structured output matching the given JSON-Schema-like schema. */
  structuredComplete<T>(
    prompt: string,
    schema: StructuredSchema,
    options?: CompletionOptions
  ): Promise<T>;

  /** Generate a vector embedding for the given text. Optional capability. */
  embed?(text: string): Promise<number[]>;

  /** Count tokens in the given text using the provider's tokeniser. Optional. */
  countTokens?(text: string): Promise<number>;
}
