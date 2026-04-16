import { PostHog } from 'posthog-node';
import { createHash } from 'node:crypto';

let client: PostHog | null = null;

export function initPostHog() {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.log('PostHog: not configured (no POSTHOG_API_KEY)');
    return;
  }
  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    flushAt: 10,
    flushInterval: 30000,
  });
  console.log('PostHog: initialized');
}

export function shutdownPostHog() {
  if (client) {
    client.shutdown();
  }
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

export function trackEnrichment(params: {
  ip: string;
  tool: string;
  depth: string;
  contentTokens: number;
  enrichmentCost: number;
  modelUsed: string;
  rateLimitRemaining: number;
  rateLimitPercentUsed: number;
  latencyMs: number;
  batchSize: number;
  sourceUrl?: string;
}) {
  if (!client) return;
  const distinctId = hashIp(params.ip);
  client.capture({
    distinctId,
    event: 'enrichment_completed',
    properties: {
      tool: params.tool,
      depth: params.depth,
      content_tokens: params.contentTokens,
      enrichment_cost: params.enrichmentCost,
      model_used: params.modelUsed,
      rate_limit_remaining: params.rateLimitRemaining,
      rate_limit_percent_used: params.rateLimitPercentUsed,
      latency_ms: params.latencyMs,
      batch_size: params.batchSize,
      source_domain: params.sourceUrl ? new URL(params.sourceUrl).hostname : undefined,
    },
  });
}

export function trackEnrichmentFailed(params: {
  ip: string;
  tool: string;
  errorType: string;
  errorMessage: string;
}) {
  if (!client) return;
  client.capture({
    distinctId: hashIp(params.ip),
    event: 'enrichment_failed',
    properties: {
      tool: params.tool,
      error_type: params.errorType,
      error_message: params.errorMessage,
    },
  });
}

export function trackRateLimitHit(params: {
  ip: string;
  requestsInWindow: number;
}) {
  if (!client) return;
  client.capture({
    distinctId: hashIp(params.ip),
    event: 'rate_limit_hit',
    properties: {
      requests_in_window: params.requestsInWindow,
    },
  });
}
