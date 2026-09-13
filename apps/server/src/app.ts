import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { ServerConfig } from "./config.js";
import { createHealthHandler } from "./health.js";
import { createMcpHandler } from "./mcp-handler.js";
import { RateLimiter } from "./rate-limit.js";
import { EnrichmentService, type EnrichmentServiceDeps } from "./tools.js";

/**
 * Build the Express app. Separated from `index.ts` so tests can mount it on
 * an ephemeral port with a fake enrichment router.
 */
export function createApp(config: ServerConfig, deps: EnrichmentServiceDeps = {}): Express {
  const app = express();

  // Behind Railway/Vercel/etc. the client IP arrives in X-Forwarded-For;
  // without this every caller shares the proxy's IP and one rate-limit bucket.
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(
    cors({
      // Non-browser MCP clients send no Origin and are unaffected. Browsers are
      // only allowed from the configured origins.
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "Mcp-Protocol-Version"],
      exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After", "Mcp-Session-Id"],
    })
  );

  const limiter = new RateLimiter({ limit: config.rateLimitPerHour });
  const service = new EnrichmentService(config, deps);

  app.get("/health", createHealthHandler(config));

  // Body limit sized for a full batch (10 × maxContentLength) plus JSON overhead.
  const bodyLimit = Math.ceil((config.maxBatchSize * config.maxContentLength * 1.5) / 1024) + 64;
  app.post("/mcp", express.json({ limit: `${bodyLimit}kb` }), createMcpHandler({ config, limiter, service }));
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "SSE not supported in stateless mode" });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "No sessions in stateless mode" });
  });

  // JSON body errors (too large, malformed) → clean 4xx instead of a stack trace.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    if (e?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Malformed JSON body" });
      return;
    }
    next(err);
  });

  return app;
}
