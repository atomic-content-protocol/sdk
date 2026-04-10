import type {
  IEnrichmentProvider,
  CompletionOptions,
  StructuredSchema,
} from "./provider.interface.js";

/**
 * OllamaProvider — wraps a local Ollama HTTP server.
 *
 * Uses built-in Node 20+ `fetch` — no external HTTP client required.
 * Supports text completion, JSON-mode structured output, and embeddings.
 */
export class OllamaProvider implements IEnrichmentProvider {
  readonly name: string;
  readonly model: string;

  private readonly baseUrl: string;

  constructor(baseUrl = "http://localhost:11434", model = "llama3.2") {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.model = model;
    this.name = `Ollama/${model}`;
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

    if (options?.systemPrompt) {
      body["system"] = options.systemPrompt;
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Ollama /api/generate failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`
      );
    }

    const data = (await response.json()) as { response?: string };
    if (!data.response) {
      throw new Error(`No response field in Ollama generate reply`);
    }

    return data.response;
  }

  async structuredComplete<T>(
    prompt: string,
    schema: StructuredSchema,
    options?: CompletionOptions
  ): Promise<T> {
    // Ollama JSON mode: pass format: "json" and embed schema instructions in prompt
    const augmentedPrompt = [
      `You are a structured data extractor. Respond with valid JSON only.`,
      `Schema name: ${schema.name}`,
      `Schema description: ${schema.description}`,
      `Schema (JSON): ${JSON.stringify(schema.parameters)}`,
      ``,
      prompt,
    ].join("\n");

    const body: Record<string, unknown> = {
      model: this.model,
      prompt: augmentedPrompt,
      stream: false,
      format: "json",
      options: {
        temperature: options?.temperature ?? 0.2, // lower default for structured
        num_predict: options?.maxTokens ?? 2_000,
      },
    };

    if (options?.systemPrompt) {
      body["system"] = options.systemPrompt;
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Ollama /api/generate (structured) failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`
      );
    }

    const data = (await response.json()) as { response?: string };
    if (!data.response) {
      throw new Error(`No response field in Ollama structured generate reply`);
    }

    try {
      return JSON.parse(data.response) as T;
    } catch {
      throw new Error(
        `Failed to parse JSON from Ollama structured response: ${data.response}`
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `Ollama /api/embed failed: ${response.status} ${response.statusText}${errText ? ` — ${errText}` : ""}`
      );
    }

    const data = (await response.json()) as {
      embeddings?: number[][];
      embedding?: number[];
    };

    // Ollama >=0.3 returns { embeddings: [[...]] }; older versions { embedding: [...] }
    const embedding = data.embeddings?.[0] ?? data.embedding;
    if (!embedding) {
      throw new Error(`No embedding returned from Ollama /api/embed`);
    }

    return embedding;
  }
}
