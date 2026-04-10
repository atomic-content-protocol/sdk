import Anthropic from "@anthropic-ai/sdk";
import type {
  IEnrichmentProvider,
  CompletionOptions,
  StructuredSchema,
} from "./provider.interface.js";

/**
 * AnthropicProvider — wraps the Anthropic Claude API.
 *
 * Client is initialised lazily on the first call so that importing the class
 * does not require a valid API key at module load time.
 */
export class AnthropicProvider implements IEnrichmentProvider {
  readonly name: string;
  readonly model: string;

  private readonly apiKey: string;
  private client: Anthropic | null = null;

  constructor(apiKey: string, model = "claude-haiku-4-5") {
    this.apiKey = apiKey;
    this.model = model;
    this.name = `Anthropic/${model}`;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
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
    const maxTokens = options?.maxTokens ?? 1_000;
    const temperature = options?.temperature ?? 0.7;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages,
    };

    if (options?.systemPrompt) {
      params.system = options.systemPrompt;
    }

    const response = await client.messages.create(params);

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((b) => b.text)
      .join("");

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
    const temperature = options?.temperature ?? 0.7;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 4_096,
      temperature,
      messages,
      tools: [
        {
          name: schema.name,
          description: schema.description,
          input_schema: schema.parameters as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool" as const, name: schema.name },
    };

    if (options?.systemPrompt) {
      params.system = options.systemPrompt;
    }

    const response = await client.messages.create(params);

    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (!toolBlock && response.stop_reason === "end_turn") {
      throw new Error(
        `Model refused to produce structured output (stop_reason: end_turn)`
      );
    }
    if (!toolBlock) {
      throw new Error(`No structured output returned from ${this.model}`);
    }

    return toolBlock.input as T;
  }
}
