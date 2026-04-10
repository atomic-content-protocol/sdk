import OpenAI from "openai";
import type {
  IEnrichmentProvider,
  CompletionOptions,
  StructuredSchema,
} from "./provider.interface.js";

/**
 * OpenAIProvider — wraps the OpenAI Chat Completions + Embeddings APIs.
 *
 * Also supports function calling for structured output and
 * `text-embedding-3-small` for vector embeddings.
 */
export class OpenAIProvider implements IEnrichmentProvider {
  readonly name: string;
  readonly model: string;

  private readonly apiKey: string;
  private client: OpenAI | null = null;

  constructor(apiKey: string, model = "gpt-4o-mini") {
    this.apiKey = apiKey;
    this.model = model;
    this.name = `OpenAI/${model}`;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        maxRetries: 0, // ProviderRouter owns retry / fallback logic
        timeout: 60_000,
      });
    }
    return this.client;
  }

  // ---------------------------------------------------------------------------
  // IEnrichmentProvider
  // ---------------------------------------------------------------------------

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const client = this.getClient();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 1_000,
      temperature: options?.temperature ?? 0.7,
      messages,
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error(`No text content returned from ${this.model}`);
    }

    return text;
  }

  async structuredComplete<T>(
    prompt: string,
    schema: StructuredSchema,
    options?: CompletionOptions
  ): Promise<T> {
    const client = this.getClient();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model: this.model,
      temperature: options?.temperature ?? 0.7,
      messages,
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
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== schema.name) {
      throw new Error(`No structured output returned from ${this.model}`);
    }

    try {
      return JSON.parse(toolCall.function.arguments) as T;
    } catch {
      throw new Error(
        `Failed to parse structured output from ${this.model}: ${toolCall.function.arguments}`
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    const client = this.getClient();

    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error(`No embedding returned from OpenAI`);
    }

    return embedding;
  }
}
