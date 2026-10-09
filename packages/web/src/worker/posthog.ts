import type { Hit } from "./serve.js";

/**
 * Sends each hit to PostHog as a `bot_fetch` event: the event name and base
 * properties Stacklist's Cloudflare analytics worker already uses, so existing
 * AI-bot queries count these hits unchanged. ACP adds what was served and what
 * it cost to read.
 *
 * Server-side on purpose: AI agents don't run JavaScript, so the PostHog
 * snippet in a page never sees them.
 */
export interface PostHogSinkOptions {
  apiKey: string;
  /** Ingestion host. Default the US cloud. */
  host?: string;
  /** Extra properties on every event, e.g. { site: "norazrnec.com", experiment: "after" }. */
  properties?: Record<string, unknown>;
}

export function posthogSink(options: PostHogSinkOptions): (hit: Hit) => Promise<void> {
  const host = (options.host ?? "https://us.i.posthog.com").replace(/\/+$/, "");
  return async (hit) => {
    const event = toEvent(hit, options.properties);
    await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: options.apiKey, ...event }),
    });
  };
}

export interface HitEvent {
  event: "bot_fetch" | "page_fetch";
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

/** The event for one hit. Exported so other sinks (logs, Analytics Engine) record the same shape. */
export function toEvent(hit: Hit, extra?: Record<string, unknown>): HitEvent {
  const { agent, request, response } = hit;
  const url = new URL(request.url);
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf ?? {};
  const length = Number(response.headers.get("content-length")) || undefined;
  const bot = agent.bot_class !== "human";

  return {
    event: bot ? "bot_fetch" : "page_fetch",
    distinct_id: bot ? `bot:${agent.agent_name ?? agent.bot_class}` : `visitor:${url.host}`,
    timestamp: new Date().toISOString(),
    properties: {
      // Same names as Stacklist's bot_fetch events.
      url: url.href,
      path: url.pathname,
      host: url.host,
      referer: request.headers.get("referer") ?? undefined,
      user_agent: request.headers.get("user-agent") ?? undefined,
      country: cf.country,
      asn: cf.asn,
      status: response.status,
      bytes_served: length,
      verified_bot_category: agent.verified_bot_category,
      bot_class: agent.bot_class,
      classification_source: agent.classification_source,
      // ACP.
      agent_name: agent.agent_name,
      served_format: hit.served_format,
      acp_reason: hit.acp_reason,
      aco_available: hit.aco_available,
      // Approximate, chars/4 like the SDK's `approximate` count; the build manifest has exact per-page counts.
      tokens_served_approx: length ? Math.ceil(length / 4) : undefined,
      $process_person_profile: false,
      ...extra,
    },
  };
}
