import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createACO } from '@atomic-content-protocol/core';
import {
  ProviderRouter,
  UnifiedPipeline,
  BatchEnricher,
  estimateEnrichmentCost,
} from '@atomic-content-protocol/enrichment';
import type { ProviderConfig } from '@atomic-content-protocol/enrichment';
import type { ACO } from '@atomic-content-protocol/core';
import { trackEnrichment, trackEnrichmentFailed } from './analytics.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_LENGTH = 50_000;
const MAX_BATCH_SIZE = 10;
const FETCH_TIMEOUT_MS = 15_000;
const ENRICHMENT_TIMEOUT_MS = 25_000;

// ---------------------------------------------------------------------------
// Provider setup (lazy singleton)
// ---------------------------------------------------------------------------

let router: ProviderRouter | null = null;

function getRouter(): ProviderRouter {
  if (!router) {
    const config: ProviderConfig = {};
    if (process.env.ANTHROPIC_API_KEY) {
      config.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
    }
    if (process.env.OPENAI_API_KEY) {
      config.openai = { apiKey: process.env.OPENAI_API_KEY };
    }
    if (Object.keys(config).length === 0) {
      throw new Error('No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
    }
    router = ProviderRouter.fromConfig(config);
  }
  return router;
}

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const enrichContentSchema = z.object({
  content: z.string().min(1).describe('The text content to enrich'),
  title: z.string().optional().describe('Optional title for the content'),
  source_type: z
    .enum(['link', 'uploaded_md', 'manual', 'converted_pdf', 'converted_doc', 'converted_video', 'selected_text', 'llm_capture'])
    .optional()
    .default('manual')
    .describe('How the content was created'),
  depth: z
    .enum(['basic', 'standard', 'deep'])
    .optional()
    .default('standard')
    .describe('Enrichment depth: basic (tags only), standard (all fields), deep (extended analysis)'),
});

const enrichUrlSchema = z.object({
  url: z.string().url().describe('The URL to fetch and enrich'),
  depth: z
    .enum(['basic', 'standard', 'deep'])
    .optional()
    .default('standard')
    .describe('Enrichment depth'),
});

const enrichBatchSchema = z.object({
  items: z
    .array(
      z.object({
        content: z.string().optional().describe('Text content (provide content or url, not both)'),
        url: z.string().url().optional().describe('URL to fetch (provide content or url, not both)'),
        title: z.string().optional().describe('Optional title'),
      })
    )
    .min(1)
    .max(10)
    .describe('Array of items to enrich (max 10)'),
  depth: z
    .enum(['basic', 'standard', 'deep'])
    .optional()
    .default('standard')
    .describe('Enrichment depth for all items'),
});

// ---------------------------------------------------------------------------
// Tool definitions for MCP ListTools
// ---------------------------------------------------------------------------

export function getTools() {
  return [
    {
      name: 'enrich_content',
      description:
        'Create and enrich an Atomic Content Object (ACO) from raw text. Returns full enriched frontmatter with tags, summary, classification, key entities, language detection, and cost estimate.',
      inputSchema: zodToJsonSchema(enrichContentSchema),
    },
    {
      name: 'enrich_url',
      description:
        'Fetch a URL, extract its content, and enrich it into an ACO. Returns enriched frontmatter with source URL, tags, summary, classification, key entities, and cost estimate.',
      inputSchema: zodToJsonSchema(enrichUrlSchema),
    },
    {
      name: 'enrich_batch',
      description:
        'Enrich multiple content items or URLs in a single call (max 10). Each item is processed in series and returned as an array of enriched ACOs.',
      inputSchema: zodToJsonSchema(enrichBatchSchema),
    },
  ];
}

// ---------------------------------------------------------------------------
// Error response helpers
// ---------------------------------------------------------------------------

function errorResponse(error: string, code: string, retryable: boolean) {
  return { success: false, error, code, retryable };
}

function validateContent(content: string): Record<string, unknown> | null {
  if (!content || content.trim().length === 0) {
    return errorResponse('Content cannot be empty', 'EMPTY_CONTENT', false);
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return errorResponse(
      `Content exceeds maximum length (${MAX_CONTENT_LENGTH.toLocaleString()} characters)`,
      'CONTENT_TOO_LARGE',
      false
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// URL fetching
// ---------------------------------------------------------------------------

async function fetchUrlContent(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ACP-MCP-Server/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const html = await response.text();

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const ogTitle =
    html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] ||
    html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i)?.[1];
  const ogImage =
    html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1] ||
    html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i)?.[1];

  const title = ogTitle || titleMatch?.[1]?.trim() || url;

  const bodyText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);

  return { title, body: bodyText, ogImage, url };
}

// ---------------------------------------------------------------------------
// Enrichment logic
// ---------------------------------------------------------------------------

const AUTHOR = { id: 'acp-server', name: 'ACP Enrichment Server' };

async function enrichACO(
  content: string,
  options: {
    title?: string;
    source_type?: string;
    depth?: 'basic' | 'standard' | 'deep';
    source_url?: string;
    ogImage?: string;
  }
): Promise<{ aco: Record<string, unknown>; body: string; cost: Record<string, unknown>; token_savings: Record<string, unknown> }> {
  const aco: ACO = await createACO({
    title: options.title,
    body: content,
    source_type: (options.source_type as Parameters<typeof createACO>[0]['source_type']) ?? 'manual',
    author: AUTHOR,
    frontmatter: {
      visibility: 'private',
      agent_accessible: true,
      status: 'final',
      ...(options.source_url ? { source_url: options.source_url } : {}),
      ...(options.ogImage
        ? { media: [{ type: 'image', url: options.ogImage, role: 'thumbnail' }] }
        : {}),
    },
  });

  const providerRouter = getRouter();
  const pipeline = new UnifiedPipeline();
  const enricher = new BatchEnricher(providerRouter, [pipeline]);

  // Wrap enrichment with a timeout. Pass tool identifier so every provenance
  // record on the resulting ACO carries the ACP §3.13 `tool` field.
  const enrichmentPromise = enricher.enrichOne(aco, {
    tool: "acp-hosted-mcp@0.1.0",
  });
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error('ENRICHMENT_TIMEOUT')), ENRICHMENT_TIMEOUT_MS);
  });
  const enriched = await Promise.race([enrichmentPromise, timeoutPromise]);

  const depth = options.depth ?? 'standard';
  const costEstimate = estimateEnrichmentCost(content, depth);

  return {
    aco: enriched.frontmatter,
    body: enriched.body,
    cost: {
      estimated: costEstimate.estimatedCost['claude-haiku-4-5'],
      model: providerRouter.model,
      depth,
      inputTokens: costEstimate.inputTokens,
      outputTokens: costEstimate.outputTokens,
    },
    token_savings: {
      content_tokens: costEstimate.contentTokens,
      frontmatter_tokens: costEstimate.frontmatterTokens,
      savings_per_read: costEstimate.savingsPerRead,
      savings_percent: Math.round(costEstimate.savingsPercent),
      break_even_reads: costEstimate.breakEvenReads,
      message: `Future reads use ~${costEstimate.frontmatterTokens} tokens instead of ~${costEstimate.contentTokens} — saving ${costEstimate.savingsPerRead.toLocaleString()} tokens (${Math.round(costEstimate.savingsPercent)}%) per read. Break-even after ${costEstimate.breakEvenReads} reads.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool call dispatcher
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
  ip: string,
  rateLimitRemaining: number
): Promise<Record<string, unknown>> {
  const limit = parseInt(process.env.RATE_LIMIT_PER_HOUR || '50', 10);
  const rateLimitPercentUsed = ((limit - rateLimitRemaining) / limit) * 100;

  try {
    switch (name) {
      case 'enrich_content': {
        const input = enrichContentSchema.parse(args);

        // Validate content
        const contentError = validateContent(input.content);
        if (contentError) return contentError;

        const start = Date.now();
        try {
          const result = await enrichACO(input.content, {
            title: input.title,
            source_type: input.source_type,
            depth: input.depth,
          });
          const latencyMs = Date.now() - start;

          const cost = result.cost as { estimated?: number; model?: string; inputTokens?: number };
          trackEnrichment({
            ip,
            tool: 'enrich_content',
            depth: input.depth,
            contentTokens: cost.inputTokens ?? 0,
            enrichmentCost: (cost.estimated as number) ?? 0,
            modelUsed: (cost.model as string) ?? 'unknown',
            rateLimitRemaining,
            rateLimitPercentUsed,
            latencyMs,
            batchSize: 1,
          });

          return { success: true, data: result };
        } catch (err) {
          const latencyMs = Date.now() - start;
          const message = err instanceof Error ? err.message : String(err);

          if (message === 'ENRICHMENT_TIMEOUT') {
            trackEnrichmentFailed({ ip, tool: 'enrich_content', errorType: 'ENRICHMENT_TIMEOUT', errorMessage: `Enrichment timed out after ${ENRICHMENT_TIMEOUT_MS / 1000}s (${latencyMs}ms)` });
            return errorResponse('Enrichment timed out', 'ENRICHMENT_TIMEOUT', true);
          }

          trackEnrichmentFailed({ ip, tool: 'enrich_content', errorType: 'PROVIDER_ERROR', errorMessage: message });
          return errorResponse(`AI provider error: ${message}`, 'PROVIDER_ERROR', true);
        }
      }

      case 'enrich_url': {
        const input = enrichUrlSchema.parse(args);

        // Fetch URL with error handling
        let fetched: Awaited<ReturnType<typeof fetchUrlContent>>;
        const start = Date.now();
        try {
          fetched = await fetchUrlContent(input.url);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof Error && err.name === 'TimeoutError') {
            trackEnrichmentFailed({ ip, tool: 'enrich_url', errorType: 'FETCH_TIMEOUT', errorMessage: `URL fetch timed out after ${FETCH_TIMEOUT_MS / 1000} seconds` });
            return errorResponse(`URL fetch timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`, 'FETCH_TIMEOUT', true);
          }
          trackEnrichmentFailed({ ip, tool: 'enrich_url', errorType: 'FETCH_ERROR', errorMessage: message });
          return errorResponse(`Failed to fetch URL: ${message}`, 'FETCH_ERROR', true);
        }

        // Validate fetched content
        const contentError = validateContent(fetched.body);
        if (contentError) return contentError;

        try {
          const result = await enrichACO(fetched.body, {
            title: fetched.title,
            source_type: 'link',
            depth: input.depth,
            source_url: fetched.url,
            ogImage: fetched.ogImage,
          });
          const latencyMs = Date.now() - start;

          const cost = result.cost as { estimated?: number; model?: string; inputTokens?: number };
          trackEnrichment({
            ip,
            tool: 'enrich_url',
            depth: input.depth,
            contentTokens: cost.inputTokens ?? 0,
            enrichmentCost: (cost.estimated as number) ?? 0,
            modelUsed: (cost.model as string) ?? 'unknown',
            rateLimitRemaining,
            rateLimitPercentUsed,
            latencyMs,
            batchSize: 1,
            sourceUrl: fetched.url,
          });

          return { success: true, data: result };
        } catch (err) {
          const latencyMs = Date.now() - start;
          const message = err instanceof Error ? err.message : String(err);

          if (message === 'ENRICHMENT_TIMEOUT') {
            trackEnrichmentFailed({ ip, tool: 'enrich_url', errorType: 'ENRICHMENT_TIMEOUT', errorMessage: `Enrichment timed out after ${ENRICHMENT_TIMEOUT_MS / 1000}s (${latencyMs}ms)` });
            return errorResponse('Enrichment timed out', 'ENRICHMENT_TIMEOUT', true);
          }

          trackEnrichmentFailed({ ip, tool: 'enrich_url', errorType: 'PROVIDER_ERROR', errorMessage: message });
          return errorResponse(`AI provider error: ${message}`, 'PROVIDER_ERROR', true);
        }
      }

      case 'enrich_batch': {
        const input = enrichBatchSchema.parse(args);

        // Validate batch size
        if (input.items.length > MAX_BATCH_SIZE) {
          return errorResponse(
            `Batch size exceeds maximum (${MAX_BATCH_SIZE} items)`,
            'BATCH_TOO_LARGE',
            false
          );
        }

        // Validate each item has content or url
        for (let i = 0; i < input.items.length; i++) {
          const item = input.items[i]!;
          if (!item.content && !item.url) {
            return errorResponse('Each item must have content or url', 'INVALID_INPUT', false);
          }
        }

        const results: Array<Record<string, unknown>> = [];
        const errors: Array<{ index: number; error: string }> = [];
        const batchStart = Date.now();

        for (let i = 0; i < input.items.length; i++) {
          const item = input.items[i]!;
          try {
            if (item.url) {
              // Fetch with error handling
              let fetched: Awaited<ReturnType<typeof fetchUrlContent>>;
              try {
                fetched = await fetchUrlContent(item.url);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (err instanceof Error && err.name === 'TimeoutError') {
                  errors.push({ index: i, error: `URL fetch timed out after ${FETCH_TIMEOUT_MS / 1000} seconds` });
                } else {
                  errors.push({ index: i, error: `Failed to fetch URL: ${message}` });
                }
                continue;
              }

              // Validate content
              const contentErr = validateContent(fetched.body);
              if (contentErr) {
                errors.push({ index: i, error: contentErr.error as string });
                continue;
              }

              const result = await enrichACO(fetched.body, {
                title: item.title || fetched.title,
                source_type: 'link',
                depth: input.depth,
                source_url: fetched.url,
                ogImage: fetched.ogImage,
              });
              results.push(result);
            } else if (item.content) {
              // Validate content
              const contentErr = validateContent(item.content);
              if (contentErr) {
                errors.push({ index: i, error: contentErr.error as string });
                continue;
              }

              const result = await enrichACO(item.content, {
                title: item.title,
                source_type: 'manual',
                depth: input.depth,
              });
              results.push(result);
            } else {
              errors.push({ index: i, error: 'Item must have either content or url' });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === 'ENRICHMENT_TIMEOUT') {
              errors.push({ index: i, error: 'Enrichment timed out' });
            } else {
              errors.push({ index: i, error: `AI provider error: ${message}` });
            }
          }
        }

        const batchLatencyMs = Date.now() - batchStart;

        // Track analytics for batch
        if (results.length > 0) {
          const firstCost = results[0]?.cost as { estimated?: number; model?: string; inputTokens?: number } | undefined;
          trackEnrichment({
            ip,
            tool: 'enrich_batch',
            depth: input.depth,
            contentTokens: firstCost?.inputTokens ?? 0,
            enrichmentCost: (firstCost?.estimated as number) ?? 0,
            modelUsed: (firstCost?.model as string) ?? 'unknown',
            rateLimitRemaining,
            rateLimitPercentUsed,
            latencyMs: batchLatencyMs,
            batchSize: input.items.length,
          });
        }

        if (errors.length > 0 && results.length === 0) {
          trackEnrichmentFailed({
            ip,
            tool: 'enrich_batch',
            errorType: 'BATCH_ALL_FAILED',
            errorMessage: `All ${input.items.length} items failed`,
          });
        }

        return {
          success: true,
          data: { items: results, errors: errors.length > 0 ? errors : undefined },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trackEnrichmentFailed({ ip, tool: name, errorType: 'UNEXPECTED_ERROR', errorMessage: message });
    return {
      success: false,
      error: message,
    };
  }
}
