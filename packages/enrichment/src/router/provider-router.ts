import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";
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
  /**
   * Called when a provider is bypassed without being tried because its
   * circuit is OPEN (or a HALF_OPEN probe is already in flight).
   */
  onProviderSkipped?: (provider: string, reason: string) => void;
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
 * directly wherever a provider is expected. `name` / `model` describe the
 * *primary* (first configured) provider; they cannot know which entry will
 * answer a given call. Pipelines therefore use the `*WithMeta` methods (via
 * `utils/provider-meta.ts`) so provenance records the model that actually
 * produced each field.
 *
 * Every attempt runs through that provider's `CircuitBreaker`, whose timeout
 * signal is forwarded to the provider so a timed-out request is cancelled.
 */
export class ProviderRouter implements IEnrichmentProvider {
  /** Name of the primary (first configured) provider. */
  get name(): string {
    return this.entries[0]?.provider.name ?? "ProviderRouter";
  }

  /** Model of the primary (first configured) provider. See class docs. */
  get model(): string {
    return this.entries[0]?.provider.model ?? "unknown";
  }

  /** Embedding model of the first provider that supports embeddings. */
  get embeddingModel(): string | undefined {
    const e = this.entries.find((x) => !!x.provider.embed);
    return e ? e.provider.embeddingModel ?? e.provider.model : undefined;
  }

  /** Read-only view of the chain for diagnostics. */
  get providers(): ReadonlyArray<{ name: string; model: string; state: string }> {
    return this.entries.map((e) => ({
      name: e.provider.name,
      model: e.provider.model,
      state: e.circuitBreaker.getState(),
    }));
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

  async embed(text: string, options?: { signal?: AbortSignal }): Promise<number[]> {
    const { result } = await this.embedWithMeta(text, options);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Typed methods that include provider metadata in the response
  // ---------------------------------------------------------------------------

  async completeWithMeta(
    prompt: string,
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    const { result, entry } = await this.withFallback("completion", (e, signal) =>
      e.provider.complete(prompt, { ...options, signal: mergeSignals(options?.signal, signal) })
    );
    return { result, provider: entry.provider.name, model: entry.provider.model };
  }

  async structuredCompleteWithMeta<T>(
    prompt: string,
    schema: StructuredSchema,
    options?: CompletionOptions
  ): Promise<StructuredResponse<T>> {
    const { result, entry } = await this.withFallback("structured completion", (e, signal) =>
      e.provider.structuredComplete<T>(prompt, schema, {
        ...options,
        signal: mergeSignals(options?.signal, signal),
      })
    );
    return { result, provider: entry.provider.name, model: entry.provider.model };
  }

  async embedWithMeta(text: string, options?: { signal?: AbortSignal }): Promise<EmbedResponse> {
    // Only try providers that have the embed capability
    const embeddable = this.entries.filter((e) => !!e.provider.embed);
    if (embeddable.length === 0) {
      throw new Error(
        "No providers in this router support embeddings. Add an OpenAI or Ollama provider."
      );
    }

    const { result, entry } = await this.withFallback(
      "embed",
      (e, signal) => {
        if (!e.provider.embed) {
          throw new Error(`Provider "${e.provider.name}" does not support embed`);
        }
        return e.provider.embed(text, { signal: mergeSignals(options?.signal, signal) });
      },
      embeddable
    );
    return {
      result,
      provider: entry.provider.name,
      model: entry.provider.embeddingModel ?? entry.provider.model,
    };
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
    invoke: (entry: ProviderEntry, signal: AbortSignal) => Promise<T>,
    entries: ProviderEntry[] = this.entries
  ): Promise<{ result: T; entry: ProviderEntry }> {
    const errors: Array<{ provider: string; error: string }> = [];
    let skipped = 0;

    for (const entry of entries) {
      const { circuitBreaker, provider } = entry;

      try {
        const result = await circuitBreaker.execute((signal) => invoke(entry, signal));
        return { result, entry };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (err instanceof CircuitOpenError) {
          // Not a provider failure: the breaker refused the call. Report it
          // separately so operators can see a provider being bypassed.
          skipped += 1;
          this.options.onProviderSkipped?.(provider.name, err.message);
          continue;
        }
        errors.push({ provider: provider.name, error: err.message });
        this.options.onProviderFailure?.(provider.name, err);
      }
    }

    const tried = errors.map((e) => e.provider).join(" → ");
    throw new Error(
      `All providers exhausted for "${operationName}". Tried: ${
        tried || "(none available — all circuits OPEN)"
      }${skipped ? ` (${skipped} skipped, circuit open)` : ""}. Errors: ${JSON.stringify(errors)}`
    );
  }
}

/** Combine the caller's signal with the breaker's timeout signal. */
function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = (s: AbortSignal) => () => controller.abort(s.reason);
  a.addEventListener("abort", onAbort(a), { once: true });
  b.addEventListener("abort", onAbort(b), { once: true });
  return controller.signal;
}
