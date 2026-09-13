import { PostHog } from "posthog-node";
import { createHash } from "node:crypto";

let client: PostHog | null = null;

export function initPostHog(apiKey: string | undefined, host: string): void {
  if (!apiKey) {
    console.log("PostHog: not configured (no POSTHOG_API_KEY)");
    return;
  }
  client = new PostHog(apiKey, { host, flushAt: 10, flushInterval: 30_000 });
  console.log("PostHog: initialized");
}

/** Flush and close. Awaited during graceful shutdown so buffered events are not lost. */
export async function shutdownPostHog(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  try {
    await c.shutdown();
  } catch (err) {
    console.error("PostHog: shutdown failed", err);
  }
}

/** Clients are identified by a salted hash of their key/IP — never the raw value. */
function hashClient(id: string): string {
  return createHash("sha256").update(`acp-mcp:${id}`).digest("hex").slice(0, 16);
}

function safeHostname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function trackEnrichment(params: {
  clientId: string;
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
}): void {
  if (!client) return;
  client.capture({
    distinctId: hashClient(params.clientId),
    event: "enrichment_completed",
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
      source_domain: safeHostname(params.sourceUrl),
    },
  });
}

export function trackEnrichmentFailed(params: {
  clientId: string;
  tool: string;
  errorType: string;
  errorMessage: string;
}): void {
  if (!client) return;
  client.capture({
    distinctId: hashClient(params.clientId),
    event: "enrichment_failed",
    properties: {
      tool: params.tool,
      error_type: params.errorType,
      error_message: params.errorMessage.slice(0, 500),
    },
  });
}

export function trackRateLimitHit(params: { clientId: string; requestsInWindow: number }): void {
  if (!client) return;
  client.capture({
    distinctId: hashClient(params.clientId),
    event: "rate_limit_hit",
    properties: { requests_in_window: params.requestsInWindow },
  });
}

export function trackBudgetExceeded(params: { clientId: string; spentToday: number; cap: number }): void {
  if (!client) return;
  client.capture({
    distinctId: hashClient(params.clientId),
    event: "budget_exceeded",
    properties: { spent_today_usd: params.spentToday, cap_usd: params.cap },
  });
}
