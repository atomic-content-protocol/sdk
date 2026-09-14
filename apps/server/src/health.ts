import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { ServerConfig } from "./config.js";

const startedAt = Date.now();

/**
 * Random per-process id. Rate limiting and the spend guard are in-memory, so
 * their budgets are **per instance**. Probing /health a few times and counting
 * distinct `instance` values tells you how many replicas are serving traffic,
 * and therefore the real effective limits.
 */
const INSTANCE = randomBytes(4).toString("hex");

export function createHealthHandler(config: ServerConfig) {
  return (_req: Request, res: Response): void => {
    res.json({
      status: "ok",
      service: "acp-mcp-server",
      instance: INSTANCE,
      version: config.version,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      providers: {
        anthropic: Boolean(config.anthropicApiKey),
        openai: Boolean(config.openaiApiKey),
      },
      quality: config.quality,
      auth: config.apiKeys.length > 0 ? "bearer" : "none",
      // Both budgets below are enforced per instance (in-memory).
      rate_limit_per_hour: config.rateLimitPerHour,
      daily_cost_cap_usd: Number.isFinite(config.dailyCostCapUsd) ? config.dailyCostCapUsd : null,
    });
  };
}
