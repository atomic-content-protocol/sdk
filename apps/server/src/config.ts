/**
 * Server configuration, read once from the environment.
 *
 * Every knob has a safe default so the server runs with only an AI provider
 * key set; the optional ones tighten the public surface.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { QualityTier } from "@atomic-content-protocol/enrichment";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
  name: string;
  version: string;
};

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

function list(env: NodeJS.ProcessEnv, name: string): string[] {
  return (env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const QUALITY_TIERS: readonly QualityTier[] = ["fast", "balanced", "best"];

export interface ServerConfig {
  version: string;
  port: number;
  /** Express `trust proxy` setting. Railway/Vercel/most PaaS sit one hop in front. */
  trustProxy: number | boolean;
  /** Weighted units per hour per client (batch of N costs N). */
  rateLimitPerHour: number;
  /** Optional bearer tokens. When non-empty, `/mcp` requires one. */
  apiKeys: string[];
  /** Allowed CORS origins. Empty means no browser origins are allowed. */
  corsOrigins: string[];
  /**
   * Headers consulted, in order, for the real client address before falling
   * back to `req.ip`. Platform proxies (Railway/Envoy, Cloudflare) set one of
   * these to the external client; `req.ip` under `trust proxy` can resolve to
   * an internal proxy address that differs per request, which would hand every
   * request its own rate-limit bucket.
   */
  clientIpHeaders: string[];
  /** Max estimated USD spend per UTC day across all clients. Infinity = off. */
  dailyCostCapUsd: number;
  quality: QualityTier;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  posthogApiKey?: string;
  posthogHost: string;
  maxContentLength: number;
  maxBatchSize: number;
  enrichmentTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const qualityRaw = env.ENRICHMENT_QUALITY ?? "fast";
  if (!QUALITY_TIERS.includes(qualityRaw as QualityTier)) {
    throw new Error(`Invalid ENRICHMENT_QUALITY: ${qualityRaw} (expected ${QUALITY_TIERS.join(" | ")})`);
  }

  const trustRaw = env.TRUST_PROXY ?? "1";
  const trustProxy: number | boolean =
    trustRaw === "true" ? true : trustRaw === "false" ? false : Number.parseInt(trustRaw, 10);
  if (typeof trustProxy === "number" && !Number.isFinite(trustProxy)) {
    throw new Error(`Invalid TRUST_PROXY: ${trustRaw}`);
  }

  const capRaw = env.DAILY_COST_CAP_USD;

  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) {
    throw new Error("No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
  }
  if (trustProxy === true) {
    console.warn(
      "[config] TRUST_PROXY=true trusts every X-Forwarded-For hop; clients can spoof their IP and bypass per-client rate limits. Prefer a hop count (e.g. 1)."
    );
  }

  return {
    version: pkg.version,
    port: int(env, "PORT", 3000),
    trustProxy,
    rateLimitPerHour: int(env, "RATE_LIMIT_PER_HOUR", 50),
    apiKeys: list(env, "MCP_API_KEYS"),
    corsOrigins: list(env, "CORS_ORIGINS"),
    clientIpHeaders: (env.CLIENT_IP_HEADERS ?? "x-envoy-external-address,cf-connecting-ip,true-client-ip,x-real-ip")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    dailyCostCapUsd:
      capRaw === undefined || capRaw === "" ? Number.POSITIVE_INFINITY : num(env, "DAILY_COST_CAP_USD", 0),
    quality: qualityRaw as QualityTier,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    posthogApiKey: env.POSTHOG_API_KEY || undefined,
    posthogHost: env.POSTHOG_HOST || "https://us.i.posthog.com",
    maxContentLength: int(env, "MAX_CONTENT_LENGTH", 50_000),
    maxBatchSize: 10,
    enrichmentTimeoutMs: int(env, "ENRICHMENT_TIMEOUT_MS", 25_000),
  };
}

/** ACP §3.13 `tool` identifier for this hosted server. */
export const TOOL_ID = `acp-hosted-mcp@${pkg.version}`;
export const SERVER_NAME = "acp-enrichment-server";
export const SERVER_VERSION = pkg.version;
