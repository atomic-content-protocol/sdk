import type { ACO, FetchedPage } from "@atomic-content-protocol/core";
import { createACO, FetchError, fetchPageForUrl, SOURCE_TYPES, ValidationError } from "@atomic-content-protocol/core";
import type { ProviderConfig } from "@atomic-content-protocol/enrichment";
import {
  BatchEnricher,
  CircuitTimeoutError,
  estimateEnrichmentCost,
  MODEL_PRESETS,
  ProviderRouter,
  UnifiedPipeline,
} from "@atomic-content-protocol/enrichment";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { trackBudgetExceeded, trackEnrichment, trackEnrichmentFailed } from "./analytics.js";
import type { ServerConfig } from "./config.js";
import { TOOL_ID } from "./config.js";
import { SpendGuard } from "./rate-limit.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Depth = "basic" | "standard" | "deep";

export interface ToolContext {
  /** Hashed-later identity of the caller (API key or IP). */
  clientId: string;
  rateLimitRemaining: number;
  rateLimitLimit: number;
}

export interface ToolError {
  success: false;
  error: string;
  code: string;
  retryable: boolean;
}

export interface ToolSuccess<T = unknown> {
  success: true;
  data: T;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolError;

export interface EnrichedItem {
  aco: Record<string, unknown>;
  body: string;
  cost: {
    estimated: number;
    model: string;
    depth: Depth;
    inputTokens: number;
    outputTokens: number;
  };
  token_savings: {
    content_tokens: number;
    frontmatter_tokens: number;
    savings_per_read: number;
    savings_percent: number;
    break_even_reads: number;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const depthSchema = z
  .enum(["basic", "standard", "deep"])
  .default("standard")
  .describe(
    "Cost-estimate profile. Enrichment output is the same for every value; the estimate assumes shorter or longer frontmatter."
  );

const enrichContentSchema = z.object({
  content: z.string().min(1).describe("The text content to enrich"),
  title: z.string().max(500).optional().describe("Optional title for the content"),
  source_type: z.enum(SOURCE_TYPES).default("manual").describe("How the content was created"),
  depth: depthSchema,
});

const enrichUrlSchema = z.object({
  url: z
    .string()
    .url()
    .describe("HTTPS URL to fetch and enrich. Redirects are followed (max 5) with every hop re-validated."),
  depth: depthSchema,
});

const enrichBatchSchema = z.object({
  items: z
    .array(
      z.object({
        content: z.string().optional().describe("Text content (provide content or url, not both)"),
        url: z.string().url().optional().describe("HTTPS URL to fetch (provide content or url, not both)"),
        title: z.string().max(500).optional().describe("Optional title"),
      })
    )
    .min(1)
    .max(10)
    .describe("Array of items to enrich (max 10). Each item counts against the rate limit."),
  depth: depthSchema,
});

export type EnrichBatchInput = z.infer<typeof enrichBatchSchema>;

/** Strip the `$schema` key zod-to-json-schema emits; strict MCP clients reject it inside inputSchema. */
function toInputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _omit, ...rest } = zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>;
  return rest;
}

export const TOOL_DEFINITIONS = [
  {
    name: "enrich_content",
    description:
      "Create and enrich an Atomic Content Object (ACO) from raw text. Returns full enriched frontmatter with tags, summary, classification, key entities, language detection, and cost estimate.",
    inputSchema: toInputSchema(enrichContentSchema),
  },
  {
    name: "enrich_url",
    description:
      "Fetch an HTTPS URL, extract its content, and enrich it into an ACO. Redirects are followed. Returns enriched frontmatter with the final source URL, tags, summary, classification, key entities, and cost estimate.",
    inputSchema: toInputSchema(enrichUrlSchema),
  },
  {
    name: "enrich_batch",
    description:
      "Enrich multiple content items or URLs in a single call (max 10). Returns an array of enriched ACOs plus per-item errors.",
    inputSchema: toInputSchema(enrichBatchSchema),
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export function isToolName(name: string): name is ToolName {
  return TOOL_DEFINITIONS.some((t) => t.name === name);
}

/**
 * Rate-limit weight of a call. Batches cost one unit per item so the hourly
 * limit reflects LLM spend rather than HTTP requests.
 */
export function toolCallWeight(name: string, args: unknown): number {
  if (name !== "enrich_batch") return 1;
  const items = (args as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? Math.max(1, Math.min(items.length, 10)) : 1;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function fail(error: string, code: string, retryable: boolean): ToolError {
  return { success: false, error, code, retryable };
}

/**
 * Map any thrown value to a client-safe ToolError. Upstream provider messages
 * are logged server-side but never echoed verbatim to clients.
 */
function isAuthError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return (
    status === 401 ||
    status === 403 ||
    /authentication_error|invalid x-api-key|incorrect api key/i.test(String((err as Error)?.message ?? ""))
  );
}

function toToolError(err: unknown, log: (msg: string) => void): ToolError {
  if (err instanceof ValidationError) {
    const code = /url|host|address|https/i.test(err.message) ? "INVALID_URL" : "INVALID_INPUT";
    return fail(err.message, code, false);
  }
  if (err instanceof FetchError) {
    const code = err.networkCode ?? "FETCH_ERROR";
    return fail(`Failed to fetch URL (${code})`, "FETCH_ERROR", !err.permanent);
  }
  if (err instanceof CircuitTimeoutError || (err instanceof Error && err.name === "TimeoutError")) {
    return fail("Enrichment timed out", "ENRICHMENT_TIMEOUT", true);
  }
  if (err instanceof z.ZodError) {
    const issues = err.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    return fail(`Invalid input: ${issues}`, "INVALID_INPUT", false);
  }
  const message = err instanceof Error ? err.message : String(err);
  log(`provider error: ${message}`);
  if (isAuthError(err)) return fail("AI provider rejected the server's credentials", "PROVIDER_AUTH", false);
  return fail("AI provider error", "PROVIDER_ERROR", true);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const AUTHOR = { id: "acp-server", name: "ACP Enrichment Server" };

export interface EnrichmentServiceDeps {
  /** Injected router — tests pass a fake. Defaults to one built from config. */
  router?: ProviderRouter;
  spendGuard?: SpendGuard;
  log?: (msg: string) => void;
  now?: () => number;
}

/**
 * EnrichmentService — owns the provider router, spend guard and tool
 * dispatch for the hosted server. One instance per process.
 */
export class EnrichmentService {
  private readonly config: ServerConfig;
  private readonly spendGuard: SpendGuard;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;
  private routerInstance: ProviderRouter | null;

  constructor(config: ServerConfig, deps: EnrichmentServiceDeps = {}) {
    this.config = config;
    this.routerInstance = deps.router ?? null;
    this.spendGuard = deps.spendGuard ?? new SpendGuard(config.dailyCostCapUsd);
    this.log = deps.log ?? ((m) => console.error(`[tools] ${m}`));
    this.now = deps.now ?? Date.now;
  }

  get router(): ProviderRouter {
    if (!this.routerInstance) {
      const providers: ProviderConfig = { quality: this.config.quality };
      if (this.config.anthropicApiKey) providers.anthropic = { apiKey: this.config.anthropicApiKey };
      if (this.config.openaiApiKey) providers.openai = { apiKey: this.config.openaiApiKey };
      if (!providers.anthropic && !providers.openai) {
        throw new Error("No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
      }
      // The breaker timeout aborts the underlying HTTP request, so no extra race is needed.
      this.routerInstance = ProviderRouter.fromConfig(providers, {
        requestTimeoutMs: this.config.enrichmentTimeoutMs,
      });
    }
    return this.routerInstance;
  }

  get spend(): SpendGuard {
    return this.spendGuard;
  }

  /** Headline model for cost reporting: whichever provider is primary. */
  private get estimateModel(): string {
    const preset = MODEL_PRESETS[this.config.quality];
    return this.config.anthropicApiKey ? preset.anthropic : preset.openai;
  }

  // ---- content guards -----------------------------------------------------

  private validateContent(content: string): ToolError | null {
    if (!content || content.trim().length === 0) {
      return fail("Content cannot be empty", "EMPTY_CONTENT", false);
    }
    if (content.length > this.config.maxContentLength) {
      return fail(
        `Content exceeds maximum length (${this.config.maxContentLength.toLocaleString()} characters)`,
        "CONTENT_TOO_LARGE",
        false
      );
    }
    return null;
  }

  // ---- fetching -------------------------------------------------------------

  /** SSRF-guarded fetch via core (HTTPS only, private ranges blocked, DNS checked, 10 MB cap). */
  private fetchPage(url: string): Promise<FetchedPage> {
    return fetchPageForUrl(url, {
      maxChars: this.config.maxContentLength,
      userAgent: `ACP-MCP-Server/${this.config.version}`,
    });
  }

  // ---- core enrichment --------------------------------------------------------

  private async enrichACO(
    content: string,
    options: {
      title?: string;
      source_type?: (typeof SOURCE_TYPES)[number];
      depth: Depth;
      source_url?: string;
      ogImage?: string;
    }
  ): Promise<EnrichedItem> {
    const estimate = estimateEnrichmentCost(content, options.depth, { model: this.estimateModel });

    if (!this.spendGuard.tryReserve(estimate.cost)) {
      throw new BudgetExceededError(this.spendGuard.spentToday, this.spendGuard.cap);
    }

    let enriched: ACO;
    try {
      const aco = await createACO({
        title: options.title,
        body: content,
        source_type: options.source_type ?? "manual",
        author: AUTHOR,
        frontmatter: {
          visibility: "private",
          agent_accessible: true,
          status: "final",
          ...(options.source_url ? { source_url: options.source_url } : {}),
          ...(options.ogImage ? { media: [{ type: "image", url: options.ogImage, role: "thumbnail" }] } : {}),
        },
      });

      const enricher = new BatchEnricher(this.router, [new UnifiedPipeline()]);
      enriched = await enricher.enrichOne(aco, { tool: TOOL_ID });
    } catch (err) {
      this.spendGuard.release(estimate.cost);
      throw err;
    }

    const provenance = enriched.frontmatter["provenance"] as Record<string, { model?: string }> | undefined;
    const modelUsed = provenance?.["summary"]?.model ?? provenance?.["tags"]?.model ?? this.router.model;

    return {
      aco: enriched.frontmatter,
      body: enriched.body,
      cost: {
        estimated: estimate.cost,
        model: modelUsed,
        depth: options.depth,
        inputTokens: estimate.inputTokens,
        outputTokens: estimate.outputTokens,
      },
      token_savings: {
        content_tokens: estimate.contentTokens,
        frontmatter_tokens: estimate.frontmatterTokens,
        savings_per_read: estimate.savingsPerRead,
        savings_percent: Math.round(estimate.savingsPercent),
        break_even_reads: estimate.breakEvenReads,
        message:
          estimate.savingsPerRead > 0
            ? `Future reads use ~${estimate.frontmatterTokens} tokens instead of ~${estimate.contentTokens} — saving ${estimate.savingsPerRead.toLocaleString()} tokens (${Math.round(estimate.savingsPercent)}%) per read. Break-even after ${estimate.breakEvenReads} reads.`
            : `This content (~${estimate.contentTokens} tokens) is already shorter than its enriched frontmatter (~${estimate.frontmatterTokens} tokens), so enrichment adds structure and searchability rather than saving tokens.`,
      },
    };
  }

  // ---- dispatch ---------------------------------------------------------------

  async handleToolCall(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const percentUsed =
      ctx.rateLimitLimit > 0 ? ((ctx.rateLimitLimit - ctx.rateLimitRemaining) / ctx.rateLimitLimit) * 100 : 0;
    const start = this.now();

    const track = (tool: string, depth: Depth, item: EnrichedItem, batchSize: number, sourceUrl?: string) =>
      trackEnrichment({
        clientId: ctx.clientId,
        tool,
        depth,
        contentTokens: item.cost.inputTokens,
        enrichmentCost: item.cost.estimated,
        modelUsed: item.cost.model,
        rateLimitRemaining: ctx.rateLimitRemaining,
        rateLimitPercentUsed: percentUsed,
        latencyMs: this.now() - start,
        batchSize,
        sourceUrl,
      });

    const failed = (tool: string, error: ToolError): ToolError => {
      if (error.code === "BUDGET_EXCEEDED") {
        trackBudgetExceeded({
          clientId: ctx.clientId,
          spentToday: this.spendGuard.spentToday,
          cap: this.spendGuard.cap,
        });
      } else {
        trackEnrichmentFailed({ clientId: ctx.clientId, tool, errorType: error.code, errorMessage: error.error });
      }
      return error;
    };

    try {
      switch (name) {
        case "enrich_content": {
          const input = enrichContentSchema.parse(args);
          const bad = this.validateContent(input.content);
          if (bad) return failed(name, bad);
          try {
            const item = await this.enrichACO(input.content, {
              title: input.title,
              source_type: input.source_type,
              depth: input.depth,
            });
            track(name, input.depth, item, 1);
            return { success: true, data: item };
          } catch (err) {
            return failed(name, this.mapError(err));
          }
        }

        case "enrich_url": {
          const input = enrichUrlSchema.parse(args);
          try {
            const page = await this.fetchPage(input.url);
            const bad = this.validateContent(page.text);
            if (bad) return failed(name, bad);
            const item = await this.enrichACO(page.text, {
              title: page.title,
              source_type: "link",
              depth: input.depth,
              source_url: page.url,
              ogImage: page.ogImage,
            });
            track(name, input.depth, item, 1, page.url);
            return { success: true, data: item };
          } catch (err) {
            return failed(name, this.mapError(err));
          }
        }

        case "enrich_batch": {
          const input = enrichBatchSchema.parse(args);
          for (const item of input.items) {
            if (item.content === undefined && item.url === undefined) {
              return fail("Each item must have content or url", "INVALID_INPUT", false);
            }
            if (item.content !== undefined && item.url !== undefined) {
              return fail("Provide content or url per item, not both", "INVALID_INPUT", false);
            }
          }

          const results: EnrichedItem[] = [];
          const errors: Array<{ index: number; error: string; code: string }> = [];

          for (let i = 0; i < input.items.length; i++) {
            const item = input.items[i] as EnrichBatchInput["items"][number];
            try {
              let content: string;
              let opts: Parameters<EnrichmentService["enrichACO"]>[1];
              if (item.url) {
                const page = await this.fetchPage(item.url);
                content = page.text;
                opts = {
                  title: item.title || page.title,
                  source_type: "link",
                  depth: input.depth,
                  source_url: page.url,
                  ogImage: page.ogImage,
                };
              } else {
                content = item.content as string;
                opts = { title: item.title, source_type: "manual", depth: input.depth };
              }
              const bad = this.validateContent(content);
              if (bad) {
                errors.push({ index: i, error: bad.error, code: bad.code });
                continue;
              }
              results.push(await this.enrichACO(content, opts));
            } catch (err) {
              const mapped = this.mapError(err);
              errors.push({ index: i, error: mapped.error, code: mapped.code });
              if (mapped.code === "BUDGET_EXCEEDED") break; // no point continuing
            }
          }

          if (results.length > 0) {
            const totalCost = results.reduce((sum, r) => sum + r.cost.estimated, 0);
            const totalTokens = results.reduce((sum, r) => sum + r.cost.inputTokens, 0);
            trackEnrichment({
              clientId: ctx.clientId,
              tool: name,
              depth: input.depth,
              contentTokens: totalTokens,
              enrichmentCost: totalCost,
              modelUsed: results[0]?.cost.model ?? "unknown",
              rateLimitRemaining: ctx.rateLimitRemaining,
              rateLimitPercentUsed: percentUsed,
              latencyMs: this.now() - start,
              batchSize: input.items.length,
            });
          } else if (errors.length > 0) {
            trackEnrichmentFailed({
              clientId: ctx.clientId,
              tool: name,
              errorType: "BATCH_ALL_FAILED",
              errorMessage: `All ${input.items.length} items failed`,
            });
          }

          return { success: true, data: { items: results, errors: errors.length > 0 ? errors : undefined } };
        }

        default:
          return fail(`Unknown tool: ${name}`, "UNKNOWN_TOOL", false);
      }
    } catch (err) {
      return failed(name, this.mapError(err));
    }
  }

  private mapError(err: unknown): ToolError {
    if (err instanceof BudgetExceededError) {
      return fail("Daily enrichment budget exhausted; try again tomorrow or self-host", "BUDGET_EXCEEDED", true);
    }
    return toToolError(err, this.log);
  }
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentToday: number,
    readonly cap: number
  ) {
    super(`Daily cost cap reached: $${spentToday.toFixed(4)} of $${cap.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}
