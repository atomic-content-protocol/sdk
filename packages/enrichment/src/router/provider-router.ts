import { CircuitBreaker } from "./circuit-breaker.js";
import { AnthropicProvider } from "../providers/anthropic.provider.js";
import { OpenAIProvider } from "../providers/openai.provider.js";
import { OllamaProvider } from "../providers/ollama.provider.js";
import type {
  IEnrichmentProvider,
  CompletionOptions,
  StructuredSchema,
} from "../providers/provider.interface.js";
import { MODEL_PRESETS, DEFAULT_QUALITY, type QualityTier } from "../providers/models.js";

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /**
   * Quality tier that selects default models for every configured provider
   * (`fast` → Haiku 4.5 / GPT-5.6 Luna, `balanced` → Sonnet 5 / GPT-5.6 Terra,
   * `best` → Opus 5 / GPT-5.6 Sol). An explicit per-provider `model` wins.
   * Default: `fast`.
   */
  quality?: QualityTier;
  anthropic?: { apiKey: string; model?: string };
  openai?: { apiKey: string; model?: string; embeddingModel?: string };
  ollama?: { baseUrl?: string; model?: string; embeddingModel?: string };
}

export interface RouterOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Called when a provider attempt fails. Useful for structured logging. */
  onProviderFailure?: (provider: string, error: Error) => void;
}

// ---------------------------------------------------------------------------
// Return types — include which provider actually handled the request
// ---------------------------------------------------------------------------

export interface CompletionResponse {
  result: string;
  provider: string;
  model: string;
}

export interface StructuredResponse<T> {
  result: T;
  provider: string;
  model: string;
}

export interface EmbedResponse {
  result: number[];
  provider: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Internal entry type
// ---------------------------------------------------------------------------

interface ProviderEntry {
  provider: IEnrichmentProvider;
  circuitBreaker: CircuitBreaker;
}

// ---------------------------------------------------------------------------
// ProviderRouter
// ---------------------------------------------------------------------------

/**
 * ProviderRouter — wraps multiple providers with circuit breakers and
 * automatic fallback.
 *
 * The router itself implements `IEnrichmentProvider` so it can be passed
 * directly wherever a provider is expected. When used as a provider, it
 * delegates to the first healthy entry in the chain and returns only the
 * string/structured result (no provider metadata).
 *
 * Use the typed `complete`/`structuredComplete`/`embed` methods directly when
 * you need to know which provider handled the request.
 */
export class ProviderRouter implements IEnrichmentProvider {
  // IEnrichmentProvider identity fields: reflect the first healthy provider
  get name(): string {
    return this.entries[0]?.provider.name ?? "ProviderRouter";
  }

  get model(): string {
    return this.entries[0]?.provider.model ?? "unknown";
  }

  private readonly entries: ProviderEntry[];
  private readonly options: RouterOptions;

  constructor(providers: IEnrichmentProvider[], options: RouterOptions = {}) {
    this.options = options;
    this.entries = providers.map((provider) => ({
      provider,
      circuitBreaker: new CircuitBreaker(provider.name, {
        failureThreshold: options.failureThreshold ?? 5,
        resetTimeoutMs: options.resetTimeoutMs ?? 30_000,
        requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      }),
    }));
  }

  // ---------------------------------------------------------------------------
  // IEnrichmentProvider implementation (delegates to typed methods below)
  // ---------------------------------------------------------------------------

  async complete(
    prompt: string,
    options?: CompletionOptions
  ): Promise<string> {
    const { result } = await this.completeWithMeta(prompt, options);
    return result;
  }

  async structuredComplete<T>(
    prompt: string,
    schema: StructuredSchema,
    options?: CompletionOptions
  ): Promise<T> {
    const { result } = await this.structuredCompleteWithMeta<T>(
      prompt,
      schema,
      options
    );
    return result;
  }

  async embed(text: string): Promise<number[]> {
    const { result } = await this.embedWithMeta(text);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Typed methods that include provider metadata in the response
  // ---------------------------------------------------------------------------

  async completeWithMeta(
    prompt: string,
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    const { result, entry } = await this.withFallback("completion", (e) =>
      e.provider.complete(prompt, options)
    );
    return { result, provider: entry.provider.name, model: entry.provider.model };
  }

  async structuredCompleteWithMeta<T>(
    prompt: string,
    schema: StructuredSchema,
    options?: CompletionOptions
  ): Promise<StructuredResponse<T>> {
    const { result, entry } = await this.withFallback(
      "structured completion",
      (e) => e.provider.structuredComplete<T>(prompt, schema, options)
    );
    return { result, provider: entry.provider.name, model: entry.provider.model };
  }

  async embedWithMeta(text: string): Promise<EmbedResponse> {
    // Only try providers that have the embed capability
    const embeddable = this.entries.filter((e) => !!e.provider.embed);
    if (embeddable.length === 0) {
      throw new Error(
        "No providers in this router support embeddings. Add an OpenAI or Ollama provider."
      );
    }

    const { result, entry } = await this.withFallback(
      "embed",
      (e) => {
        if (!e.provider.embed) {
          throw new Error(`Provider "${e.provider.name}" does not support embed`);
        }
        return e.provider.embed(text);
      },
      embeddable
    );
    return { result, provider: entry.provider.name, model: entry.provider.model };
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Build a ProviderRouter from a declarative config object.
   * Providers are added in the order: Anthropic → OpenAI → Ollama.
   */
  static fromConfig(
    config: ProviderConfig,
    options?: RouterOptions
  ): ProviderRouter {
    const providers: IEnrichmentProvider[] = [];
    const preset = MODEL_PRESETS[config.quality ?? DEFAULT_QUALITY];

    if (config.anthropic) {
      providers.push(
        new AnthropicProvider(config.anthropic.apiKey, config.anthropic.model ?? preset.anthropic)
      );
    }
    if (config.openai) {
      providers.push(
        new OpenAIProvider(config.openai.apiKey, config.openai.model ?? preset.openai, {
          embeddingModel: config.openai.embeddingModel,
        })
      );
    }
    if (config.ollama) {
      providers.push(
        new OllamaProvider(config.ollama.baseUrl, config.ollama.model, {
          embeddingModel: config.ollama.embeddingModel,
        })
      );
    }

    if (providers.length === 0) {
      throw new Error(
        "ProviderRouter.fromConfig: at least one provider must be configured."
      );
    }

    return new ProviderRouter(providers, options);
  }

  // ---------------------------------------------------------------------------
  // Generic fallback executor
  // ---------------------------------------------------------------------------

  private async withFallback<T>(
    operationName: string,
    invoke: (entry: ProviderEntry) => Promise<T>,
    entries: ProviderEntry[] = this.entries
  ): Promise<{ result: T; entry: ProviderEntry }> {
    const errors: Array<{ provider: string; error: string }> = [];

    for (const entry of entries) {
      const { circuitBreaker, provider } = entry;

      // Skip providers whose circuit is OPEN
      if (circuitBreaker.getState() === "OPEN") {
        continue;
      }

      try {
        const result = await circuitBreaker.execute(() => invoke(entry));
        return { result, entry };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ provider: provider.name, error: err.message });
        this.options.onProviderFailure?.(provider.name, err);
      }
    }

    const tried = errors.map((e) => e.provider).join(" → ");
    throw new Error(
      `All providers exhausted for "${operationName}". Tried: ${tried || "(none available — all circuits OPEN)"}. Errors: ${JSON.stringify(errors)}`
    );
  }
}
