import Anthropic from "@anthropic-ai/sdk";
import { anthropicSupportsSampling, DEFAULT_QUALITY, MODEL_PRESETS } from "./models.js";
import type { CompletionOptions, IEnrichmentProvider, StructuredSchema } from "./provider.interface.js";

/**
 * JSON Schema keywords Anthropic's constrained decoder rejects (verified live
 * against the API). Value-range checks are enforced afterwards by the Zod
 * layer in `utils/prompts.ts`, so dropping them here loses nothing.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "default",
];

/**
 * Adapt a plain JSON Schema to what Anthropic's `output_config.format`
 * accepts: every `object` must declare `additionalProperties: false`, and
 * numeric / string / array constraint keywords are not allowed. Callers keep
 * writing ordinary JSON Schema; this walk does the translation.
 */
export function toAnthropicOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (typeof node !== "object" || node === null) return node;
    const obj = { ...(node as Record<string, unknown>) };
    for (const key of UNSUPPORTED_SCHEMA_KEYWORDS) delete obj[key];
    const type = obj["type"];
    const isObject = type === "object" || (Array.isArray(type) && type.includes("object")) || "properties" in obj;
    if (isObject && obj["additionalProperties"] === undefined) obj["additionalProperties"] = false;
    for (const key of ["properties", "items", "anyOf", "oneOf", "allOf", "definitions", "$defs"]) {
      if (key in obj) {
        const value = obj[key];
        obj[key] =
          key === "properties" || key === "definitions" || key === "$defs"
            ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, visit(v)]))
            : visit(value);
      }
    }
    return obj;
  };
  return visit(schema) as Record<string, unknown>;
}

export interface AnthropicProviderOptions {
  /** Injected client — used by tests. Defaults to a real `Anthropic` client. */
  client?: Pick<Anthropic, "messages">;
  /** Per-request timeout in ms. Default 60 000. */
  timeoutMs?: number;
}

/**
 * AnthropicProvider — wraps the Anthropic Claude API.
 *
 * Client is initialised lazily on the first call so that importing the class
 * does not require a valid API key at module load time.
 *
 * Structured output uses `output_config.format` (JSON-schema constrained
 * decoding), which is supported on every current Claude model and does not
 * depend on forced tool use.
 */
export class AnthropicProvider implements IEnrichmentProvider {
  readonly name: string;
  readonly model: string;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private client: Pick<Anthropic, "messages"> | null;

  constructor(
    apiKey: string,
    model: string = MODEL_PRESETS[DEFAULT_QUALITY].anthropic,
    options: AnthropicProviderOptions = {}
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.name = `Anthropic/${model}`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.client = options.client ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getClient(): Pick<Anthropic, "messages"> {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.apiKey,
        maxRetries: 0, // ProviderRouter owns retry / fallback logic
        timeout: this.timeoutMs,
      });
    }
    return this.client;
  }

  /** Only send sampling params to models that accept them. */
  private sampling(options?: CompletionOptions): { temperature?: number } {
    if (options?.temperature === undefined) return {};
    return anthropicSupportsSampling(this.model) ? { temperature: options.temperature } : {};
  }

  // ---------------------------------------------------------------------------
  // IEnrichmentProvider
  // ---------------------------------------------------------------------------

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const client = this.getClient();

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 1_000,
      messages: [{ role: "user", content: prompt }],
      ...this.sampling(options),
    };
    if (options?.systemPrompt) params.system = options.systemPrompt;

    const response = await client.messages.create(params, { signal: options?.signal });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((b) => b.text)
      .join("");

    if (!text) {
      throw new Error(`No text content returned from ${this.model} (stop_reason: ${response.stop_reason})`);
    }

    return text;
  }

  async structuredComplete<T>(prompt: string, schema: StructuredSchema, options?: CompletionOptions): Promise<T> {
    const client = this.getClient();

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4_096,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: { type: "json_schema", schema: toAnthropicOutputSchema(schema.parameters) },
      },
      ...this.sampling(options),
    };
    const system = [
      options?.systemPrompt,
      `Respond with a single JSON object for "${schema.name}": ${schema.description}.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (system) params.system = system;

    const response = await client.messages.create(params, { signal: options?.signal });

    if (response.stop_reason === "refusal") {
      throw new Error(`Model declined to produce structured output for ${schema.name}`);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) {
      throw new Error(`No structured output returned from ${this.model} (stop_reason: ${response.stop_reason})`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Failed to parse structured output from ${this.model}: ${text.slice(0, 200)}`);
    }
  }
}
