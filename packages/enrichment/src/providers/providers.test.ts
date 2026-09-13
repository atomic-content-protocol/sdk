import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider, toAnthropicOutputSchema } from "./anthropic.provider.js";
import {
  anthropicSupportsSampling,
  MODEL_PRESETS,
  MODEL_PRICING,
  openaiIsReasoningModel,
  pricingFor,
} from "./models.js";
import { OllamaProvider } from "./ollama.provider.js";
import { OpenAIProvider } from "./openai.provider.js";

const SCHEMA = {
  name: "extract",
  description: "Extract fields",
  parameters: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
};

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

describe("model catalogue", () => {
  it("every preset model has a price", () => {
    for (const tier of Object.values(MODEL_PRESETS)) {
      expect(MODEL_PRICING[tier.anthropic], tier.anthropic).toBeDefined();
      expect(MODEL_PRICING[tier.openai], tier.openai).toBeDefined();
    }
  });

  it("fast tier defaults to Haiku 4.5 / GPT-5.6 Luna", () => {
    expect(MODEL_PRESETS.fast).toEqual({ anthropic: "claude-haiku-4-5", openai: "gpt-5.6-luna" });
  });

  it("pricingFor tolerates dated suffixes", () => {
    expect(pricingFor("claude-haiku-4-5-20251001")).toEqual(MODEL_PRICING["claude-haiku-4-5"]);
    expect(pricingFor("totally-unknown")).toBeUndefined();
  });

  it("knows which Anthropic models accept sampling params", () => {
    expect(anthropicSupportsSampling("claude-haiku-4-5")).toBe(true);
    expect(anthropicSupportsSampling("claude-sonnet-4-6")).toBe(true);
    expect(anthropicSupportsSampling("claude-sonnet-5")).toBe(false);
    expect(anthropicSupportsSampling("claude-opus-5")).toBe(false);
    expect(anthropicSupportsSampling("claude-opus-4-7")).toBe(false);
  });

  it("knows which OpenAI models are reasoning models", () => {
    expect(openaiIsReasoningModel("gpt-5.6-luna")).toBe(true);
    expect(openaiIsReasoningModel("o4-mini")).toBe(true);
    expect(openaiIsReasoningModel("gpt-4o-mini")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

function anthropicClient(response: Record<string, unknown>) {
  const create = vi.fn().mockResolvedValue(response);
  return { client: { messages: { create } } as never, create };
}

describe("AnthropicProvider", () => {
  it("complete() joins text blocks and omits temperature for Claude 5 models", async () => {
    const { client, create } = anthropicClient({
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
      stop_reason: "end_turn",
    });
    const provider = new AnthropicProvider("k", "claude-opus-5", { client });
    const text = await provider.complete("hi", { temperature: 0.3, maxTokens: 50, systemPrompt: "sys" });
    expect(text).toBe("Hello world");
    const [params, reqOptions] = create.mock.calls[0]!;
    expect(params.model).toBe("claude-opus-5");
    expect(params.max_tokens).toBe(50);
    expect(params.system).toBe("sys");
    expect(params).not.toHaveProperty("temperature");
    expect(reqOptions).toEqual({ signal: undefined });
  });

  it("complete() forwards temperature for Haiku 4.5 and the abort signal", async () => {
    const { client, create } = anthropicClient({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    const provider = new AnthropicProvider("k", "claude-haiku-4-5", { client });
    const controller = new AbortController();
    await provider.complete("hi", { temperature: 0.3, signal: controller.signal });
    const [params, reqOptions] = create.mock.calls[0]!;
    expect(params.temperature).toBe(0.3);
    expect(reqOptions.signal).toBe(controller.signal);
  });

  it("structuredComplete() uses output_config json_schema and parses the text block", async () => {
    const { client, create } = anthropicClient({
      content: [{ type: "text", text: '{"a":"b"}' }],
      stop_reason: "end_turn",
    });
    const provider = new AnthropicProvider("k", "claude-haiku-4-5", { client });
    const out = await provider.structuredComplete<{ a: string }>("p", SCHEMA);
    expect(out).toEqual({ a: "b" });
    const [params] = create.mock.calls[0]!;
    expect(params.output_config).toEqual({
      format: { type: "json_schema", schema: { ...SCHEMA.parameters, additionalProperties: false } },
    });
    expect(params).not.toHaveProperty("tools");
    expect(params).not.toHaveProperty("tool_choice");
  });

  it("structuredComplete() surfaces refusals and unparseable output as errors", async () => {
    const refused = anthropicClient({ content: [], stop_reason: "refusal" });
    await expect(
      new AnthropicProvider("k", "claude-haiku-4-5", { client: refused.client }).structuredComplete("p", SCHEMA)
    ).rejects.toThrow(/declined/);

    const garbage = anthropicClient({ content: [{ type: "text", text: "not json" }], stop_reason: "end_turn" });
    await expect(
      new AnthropicProvider("k", "claude-haiku-4-5", { client: garbage.client }).structuredComplete("p", SCHEMA)
    ).rejects.toThrow(/Failed to parse/);
  });

  it("defaults to the fast preset model", () => {
    expect(new AnthropicProvider("k").model).toBe(MODEL_PRESETS.fast.anthropic);
  });

  it("toAnthropicOutputSchema adds additionalProperties:false to nested objects only", () => {
    const out = toAnthropicOutputSchema({
      type: "object",
      properties: {
        list: { type: "array", items: { type: "object", properties: { n: { type: "string" } } } },
        open: { type: "object", additionalProperties: true },
        s: { type: ["string", "null"] },
        c: { type: "number", minimum: 0, maximum: 1, description: "keep me" },
      },
    }) as Record<string, any>;
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.list.items.additionalProperties).toBe(false);
    expect(out.properties.open.additionalProperties).toBe(true);
    expect(out.properties.s).toEqual({ type: ["string", "null"] });
    expect(out.properties.c).toEqual({ type: "number", description: "keep me" });
  });
});

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

function openaiClient(chat: Record<string, unknown>, embedding?: number[]) {
  const create = vi.fn().mockResolvedValue(chat);
  const embed = vi.fn().mockResolvedValue({ data: embedding ? [{ embedding }] : [] });
  return {
    client: { chat: { completions: { create } }, embeddings: { create: embed } } as never,
    create,
    embed,
  };
}

describe("OpenAIProvider", () => {
  it("complete() uses max_completion_tokens and omits temperature for reasoning models", async () => {
    const { client, create } = openaiClient({ choices: [{ message: { content: "hi" } }] });
    const provider = new OpenAIProvider("k", "gpt-5.6-luna", { client });
    expect(await provider.complete("p", { temperature: 0.5, maxTokens: 77 })).toBe("hi");
    const [params] = create.mock.calls[0]!;
    expect(params.max_completion_tokens).toBe(77);
    expect(params).not.toHaveProperty("max_tokens");
    expect(params).not.toHaveProperty("temperature");
  });

  it("complete() keeps temperature for non-reasoning models", async () => {
    const { client, create } = openaiClient({ choices: [{ message: { content: "hi" } }] });
    await new OpenAIProvider("k", "gpt-4o-mini", { client }).complete("p", { temperature: 0.5 });
    expect(create.mock.calls[0]![0].temperature).toBe(0.5);
  });

  it("structuredComplete() forces the function tool and parses arguments", async () => {
    const { client, create } = openaiClient({
      choices: [{ message: { tool_calls: [{ function: { name: "extract", arguments: '{"a":"z"}' } }] } }],
    });
    const out = await new OpenAIProvider("k", "gpt-5.6-luna", { client }).structuredComplete<{ a: string }>(
      "p",
      SCHEMA
    );
    expect(out).toEqual({ a: "z" });
    const [params] = create.mock.calls[0]!;
    expect(params.tool_choice).toEqual({ type: "function", function: { name: "extract" } });
  });

  it("structuredComplete() rejects a tool call for the wrong function", async () => {
    const { client } = openaiClient({
      choices: [{ message: { tool_calls: [{ function: { name: "other", arguments: "{}" } }] } }],
    });
    await expect(new OpenAIProvider("k", "gpt-5.6-luna", { client }).structuredComplete("p", SCHEMA)).rejects.toThrow(
      /No structured output/
    );
  });

  it("embed() uses the configured embedding model and exposes it", async () => {
    const { client, embed } = openaiClient({}, [0.1, 0.2]);
    const provider = new OpenAIProvider("k", "gpt-5.6-luna", { client, embeddingModel: "text-embedding-3-large" });
    expect(provider.embeddingModel).toBe("text-embedding-3-large");
    expect(await provider.embed("x")).toEqual([0.1, 0.2]);
    expect(embed.mock.calls[0]![0].model).toBe("text-embedding-3-large");
  });

  it("defaults to the fast preset model and text-embedding-3-small", () => {
    const provider = new OpenAIProvider("k");
    expect(provider.model).toBe(MODEL_PRESETS.fast.openai);
    expect(provider.embeddingModel).toBe("text-embedding-3-small");
  });
});

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

function fakeFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Server Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("OllamaProvider", () => {
  it("complete() posts to /api/generate with a timeout signal", async () => {
    const f = fakeFetch({ response: "hello" });
    const provider = new OllamaProvider("http://ollama:11434/", "llama3.2", { fetch: f });
    expect(await provider.complete("p")).toBe("hello");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://ollama:11434/api/generate");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body).model).toBe("llama3.2");
  });

  it("structuredComplete() passes the JSON schema as `format` and parses the reply", async () => {
    const f = fakeFetch({ response: '{"a":"q"}' });
    const provider = new OllamaProvider(undefined, undefined, { fetch: f });
    expect(await provider.structuredComplete("p", SCHEMA)).toEqual({ a: "q" });
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.format).toEqual(SCHEMA.parameters);
  });

  it("embed() uses a dedicated embedding model when configured", async () => {
    const f = fakeFetch({ embeddings: [[1, 2, 3]] });
    const provider = new OllamaProvider(undefined, "llama3.2", { fetch: f, embeddingModel: "nomic-embed-text" });
    expect(provider.embeddingModel).toBe("nomic-embed-text");
    expect(await provider.embed("x")).toEqual([1, 2, 3]);
    expect(JSON.parse(f.mock.calls[0]![1].body).model).toBe("nomic-embed-text");
  });

  it("embed() defaults the embedding model to the chat model", () => {
    expect(new OllamaProvider(undefined, "llama3.2").embeddingModel).toBe("llama3.2");
  });

  it("surfaces HTTP errors with status", async () => {
    const f = fakeFetch({ error: "boom" }, false, 500);
    await expect(new OllamaProvider(undefined, undefined, { fetch: f }).complete("p")).rejects.toThrow(/500/);
  });

  it("honours an already-aborted caller signal", async () => {
    const f = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (init.signal?.aborted) return Promise.reject(new Error("aborted"));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ response: "x" }) });
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    await expect(
      new OllamaProvider(undefined, undefined, { fetch: f }).complete("p", { signal: controller.signal })
    ).rejects.toThrow(/aborted/);
  });
});
