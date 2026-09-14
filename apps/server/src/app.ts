import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { ServerConfig } from "./config.js";
import { createHealthHandler, INSTANCE } from "./health.js";
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

  // Identify the serving process on every response. The rate limiter and the
  // spend guard are in-memory, so when several replicas are up each enforces
  // its own budget; this header makes that visible from the outside.
  app.use((_req, res, next) => {
    res.setHeader("X-ACP-Instance", INSTANCE);
    next();
  });
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

  // Body limit sized for a full batch (10 × maxContentLength). maxContentLength
  // counts characters; UTF-8 needs up to 4 bytes each, plus JSON escaping headroom.
  const bodyLimit = Math.ceil((config.maxBatchSize * config.maxContentLength * 4.5) / 1024) + 64;
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
    if (res.headersSent) {
      next(err);
      return;
    }
    // Anything else (unsupported Content-Encoding, charset, …): a clean JSON
    // status, never Express's HTML page with a stack trace.
    const status = typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status >= 500) console.error("[app] unhandled error:", err);
    res.status(status).json({ error: status >= 500 ? "Internal server error" : (e?.message ?? "Bad request") });
  });

  return app;
}
