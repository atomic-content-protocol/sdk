import OpenAI from "openai";
import { DEFAULT_EMBEDDING_MODELS, DEFAULT_QUALITY, MODEL_PRESETS, openaiIsReasoningModel } from "./models.js";
import type { CompletionOptions, IEnrichmentProvider, StructuredSchema } from "./provider.interface.js";

/** Minimum completion budget handed to reasoning models (visible answer + hidden reasoning). */
const REASONING_MIN_COMPLETION_TOKENS = 1_024;

export interface OpenAIProviderOptions {
  /** Embedding model used by `embed()`. Default `text-embedding-3-small`. */
  embeddingModel?: string;
  /** Injected client — used by tests. Defaults to a real `OpenAI` client. */
  client?: Pick<OpenAI, "chat" | "embeddings">;
  /** Per-request timeout in ms. Default 60 000. */
  timeoutMs?: number;
}

/**
 * OpenAIProvider — wraps the OpenAI Chat Completions + Embeddings APIs.
 *
 * Structured output uses function calling with a forced tool choice, which
 * every current chat model supports. Reasoning models (gpt-5.x, o-series)
 * reject `temperature`, so it is only sent to non-reasoning models.
 */
export class OpenAIProvider implements IEnrichmentProvider {
  readonly name: string;
  readonly model: string;
  readonly embeddingModel: string;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private client: Pick<OpenAI, "chat" | "embeddings"> | null;

  constructor(
    apiKey: string,
    model: string = MODEL_PRESETS[DEFAULT_QUALITY].openai,
    options: OpenAIProviderOptions = {}
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.name = `OpenAI/${model}`;
    this.embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODELS.openai;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.client = options.client ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getClient(): Pick<OpenAI, "chat" | "embeddings"> {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        maxRetries: 0, // ProviderRouter owns retry / fallback logic
        timeout: this.timeoutMs,
      });
    }
    return this.client;
  }

  private sampling(options?: CompletionOptions): { temperature?: number } {
    if (options?.temperature === undefined) return {};
    return openaiIsReasoningModel(this.model) ? {} : { temperature: options.temperature };
  }

  /**
   * Reasoning models spend hidden reasoning tokens from the same budget as
   * the visible answer, so a 20-token classification budget returns nothing.
   * Floor the budget and ask for low reasoning effort on those models.
   */
  private budget(maxTokens: number): { max_completion_tokens: number; reasoning_effort?: "low" } {
    if (!openaiIsReasoningModel(this.model)) return { max_completion_tokens: maxTokens };
    return { max_completion_tokens: Math.max(maxTokens, REASONING_MIN_COMPLETION_TOKENS), reasoning_effort: "low" };
  }

  private messages(prompt: string, options?: CompletionOptions): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: prompt });
    return messages;
  }

  // ---------------------------------------------------------------------------
  // IEnrichmentProvider
  // ---------------------------------------------------------------------------

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const client = this.getClient();

    const response = await client.chat.completions.create(
      {
        model: this.model,
        ...this.budget(options?.maxTokens ?? 1_000),
        messages: this.messages(prompt, options),
        ...this.sampling(options),
      },
      { signal: options?.signal }
    );

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error(`No text content returned from ${this.model}`);
    }

    return text;
  }

  async structuredComplete<T>(prompt: string, schema: StructuredSchema, options?: CompletionOptions): Promise<T> {
    const client = this.getClient();

    const response = await client.chat.completions.create(
      {
        model: this.model,
        ...this.budget(options?.maxTokens ?? 4_096),
        messages: this.messages(prompt, options),
        ...this.sampling(options),
        tools: [
          {
            type: "function",
            function: {
              name: schema.name,
              description: schema.description,
              parameters: schema.parameters,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: schema.name } },
      },
      { signal: options?.signal }
    );

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== schema.name) {
      throw new Error(`No structured output returned from ${this.model}`);
    }

    try {
      return JSON.parse(toolCall.function.arguments) as T;
    } catch {
      throw new Error(
        `Failed to parse structured output from ${this.model}: ${toolCall.function.arguments.slice(0, 200)}`
      );
    }
  }

  async embed(text: string, options?: { signal?: AbortSignal }): Promise<number[]> {
    const client = this.getClient();

    const response = await client.embeddings.create(
      { model: this.embeddingModel, input: text },
      { signal: options?.signal }
    );

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error(`No embedding returned from ${this.embeddingModel}`);
    }

    return embedding;
  }
}
