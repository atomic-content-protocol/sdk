import type { CompletionOptions, IEnrichmentProvider, StructuredSchema } from "./provider.interface.js";

export interface OllamaProviderOptions {
  /**
   * Model used by `embed()`. Defaults to the chat model for backwards
   * compatibility; a dedicated embedding model such as `nomic-embed-text`
   * gives far better vectors.
   */
  embeddingModel?: string;
  /** Per-request timeout in ms. Default 120 000 (local models can be slow). */
  timeoutMs?: number;
  /** Injected fetch — used by tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Combine an optional caller signal with a timeout into one AbortSignal. */
function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Ollama request timed out after ${timeoutMs}ms`)),
    timeoutMs
  );
  const clear = () => clearTimeout(timer);
  controller.signal.addEventListener("abort", clear, { once: true });
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * OllamaProvider — wraps a local Ollama HTTP server.
 *
 * Uses built-in Node 20+ `fetch` — no external HTTP client required.
 * Supports text completion, schema-constrained structured output (Ollama's
 * `format` accepts a JSON schema), and embeddings.
 */
export class OllamaProvider implements IEnrichmentProvider {
  readonly name: string;
  readonly model: string;
  readonly embeddingModel: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl = "http://localhost:11434", model = "llama3.2", options: OllamaProviderOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.model = model;
    this.name = `Ollama/${model}`;
    this.embeddingModel = options.embeddingModel ?? model;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async post<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combineSignals(this.timeoutMs, signal),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Ollama ${path} failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`
      );
    }

    return (await response.json()) as T;
  }

  // ---------------------------------------------------------------------------
  // IEnrichmentProvider
  // ---------------------------------------------------------------------------

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 1_000,
      },
    };
    if (options?.systemPrompt) body["system"] = options.systemPrompt;

    const data = await this.post<{ response?: string }>("/api/generate", body, options?.signal);
    if (!data.response) {
      throw new Error(`No response field in Ollama generate reply`);
    }
    return data.response;
  }

  async structuredComplete<T>(prompt: string, schema: StructuredSchema, options?: CompletionOptions): Promise<T> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: [`Respond with a single JSON object for "${schema.name}": ${schema.description}.`, ``, prompt].join("\n"),
      stream: false,
      // Ollama accepts a full JSON schema here and constrains decoding to it.
      format: schema.parameters,
      options: {
        temperature: options?.temperature ?? 0.2, // lower default for structured
        num_predict: options?.maxTokens ?? 2_000,
      },
    };
    if (options?.systemPrompt) body["system"] = options.systemPrompt;

    const data = await this.post<{ response?: string }>("/api/generate", body, options?.signal);
    if (!data.response) {
      throw new Error(`No response field in Ollama structured generate reply`);
    }

    try {
      return JSON.parse(data.response) as T;
    } catch {
      throw new Error(`Failed to parse JSON from Ollama structured response: ${data.response.slice(0, 200)}`);
    }
  }

  async embed(text: string, options?: { signal?: AbortSignal }): Promise<number[]> {
    const data = await this.post<{ embeddings?: number[][]; embedding?: number[] }>(
      "/api/embed",
      { model: this.embeddingModel, input: text },
      options?.signal
    );

    // Ollama >=0.3 returns { embeddings: [[...]] }; older versions { embedding: [...] }
    const embedding = data.embeddings?.[0] ?? data.embedding;
    if (!embedding) {
      throw new Error(`No embedding returned from Ollama /api/embed`);
    }
    return embedding;
  }
}
