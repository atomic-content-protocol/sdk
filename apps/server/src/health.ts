import type { Request, Response } from "express";
import type { ServerConfig } from "./config.js";

const startedAt = Date.now();

export function createHealthHandler(config: ServerConfig) {
  return (_req: Request, res: Response): void => {
    res.json({
      status: "ok",
      service: "acp-mcp-server",
      version: config.version,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      providers: {
        anthropic: Boolean(config.anthropicApiKey),
        openai: Boolean(config.openaiApiKey),
      },
      quality: config.quality,
      auth: config.apiKeys.length > 0 ? "bearer" : "none",
      rate_limit_per_hour: config.rateLimitPerHour,
      daily_cost_cap_usd: Number.isFinite(config.dailyCostCapUsd) ? config.dailyCostCapUsd : null,
    });
  };
}
