import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createACO } from '@acp/core';
import {
  ProviderRouter,
  UnifiedPipeline,
  BatchEnricher,
  estimateEnrichmentCost,
} from '@acp/enrichment';
import type { ProviderConfig } from '@acp/enrichment';
import type { ACO } from '@acp/core';

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
// URL fetching
// ---------------------------------------------------------------------------

async function fetchUrlContent(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ACP-MCP-Server/1.0' },
    signal: AbortSignal.timeout(15000),
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
): Promise<{ aco: Record<string, unknown>; body: string; cost: Record<string, unknown> }> {
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
  const enriched = await enricher.enrichOne(aco);

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
  };
}

// ---------------------------------------------------------------------------
// Tool call dispatcher
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'enrich_content': {
        const input = enrichContentSchema.parse(args);
        const result = await enrichACO(input.content, {
          title: input.title,
          source_type: input.source_type,
          depth: input.depth,
        });
        return { success: true, data: result };
      }

      case 'enrich_url': {
        const input = enrichUrlSchema.parse(args);
        const fetched = await fetchUrlContent(input.url);
        const result = await enrichACO(fetched.body, {
          title: fetched.title,
          source_type: 'link',
          depth: input.depth,
          source_url: fetched.url,
          ogImage: fetched.ogImage,
        });
        return { success: true, data: result };
      }

      case 'enrich_batch': {
        const input = enrichBatchSchema.parse(args);
        const results: Array<Record<string, unknown>> = [];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < input.items.length; i++) {
          const item = input.items[i]!;
          try {
            if (item.url) {
              const fetched = await fetchUrlContent(item.url);
              const result = await enrichACO(fetched.body, {
                title: item.title || fetched.title,
                source_type: 'link',
                depth: input.depth,
                source_url: fetched.url,
                ogImage: fetched.ogImage,
              });
              results.push(result);
            } else if (item.content) {
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
            errors.push({
              index: i,
              error: err instanceof Error ? err.message : String(err),
            });
          }
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
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
