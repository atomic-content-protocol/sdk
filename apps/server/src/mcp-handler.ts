import { createHash, timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { trackRateLimitHit } from "./analytics.js";
import { SERVER_NAME, SERVER_VERSION, type ServerConfig } from "./config.js";
import type { RateLimiter } from "./rate-limit.js";
import { type EnrichmentService, isToolName, TOOL_DEFINITIONS, toolCallWeight } from "./tools.js";

export interface McpHandlerDeps {
  config: ServerConfig;
  limiter: RateLimiter;
  service: EnrichmentService;
}

/**
 * Identify the calling client for rate limiting.
 *
 * `req.ip` is unreliable behind a multi-hop proxy chain: with `trust proxy: N`
 * Express skips N hops from the right, so a chain of `client, edge1, edge2`
 * yields an *internal* address that can differ per request — every request
 * then gets a fresh bucket and the limit never bites. Prefer the platform's
 * dedicated client-address header when present.
 */
export function clientAddress(req: Request, config: ServerConfig): { address: string; source: string } {
  for (const header of config.clientIpHeaders) {
    const raw = req.header(header);
    if (raw) {
      // Some proxies send a list; the first entry is the client.
      const value = raw.split(",")[0]?.trim();
      if (value) return { address: value, source: header };
    }
  }
  return { address: req.ip || req.socket.remoteAddress || "unknown", source: "req.ip" };
}

/** Stable, non-reversible id for a client address — safe to expose for diagnostics. */
export function clientKeyHash(address: string): string {
  return createHash("sha256").update(`acp-client:${address}`).digest("hex").slice(0, 8);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Identify the caller: bearer token when auth is on, else the (proxy-resolved) IP. */
export function resolveClient(req: Request, config: ServerConfig): { id: string; ip: string; authorized: boolean } {
  const ip = `ip:${clientAddress(req, config).address}`;
  if (config.apiKeys.length === 0) return { id: ip, ip, authorized: true };
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Compare against every key so timing does not reveal which prefix matched.
  let ok = false;
  for (const key of config.apiKeys) if (safeEqual(token, key)) ok = true;
  return { id: ok ? `key:${token}` : ip, ip, authorized: ok };
}

/** Weighted rate-limit cost of a JSON-RPC body; handshake messages are free. */
export function requestWeight(body: unknown): number {
  const messages = Array.isArray(body) ? body : [body];
  let weight = 0;
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) continue;
    const { method, params } = msg as { method?: string; params?: { name?: string; arguments?: unknown } };
    if (method === "tools/call") weight += toolCallWeight(params?.name ?? "", params?.arguments);
  }
  return weight;
}

export function createMcpHandler({ config, limiter, service }: McpHandlerDeps) {
  return async function mcpHandler(req: Request, res: Response): Promise<void> {
    const client = resolveClient(req, config);
    if (!client.authorized) {
      // Failed attempts are metered per IP so key guessing is rate-limited too.
      const attempt = limiter.consume(client.ip, 1);
      res.setHeader("RateLimit-Remaining", String(attempt.remaining));
      if (!attempt.allowed) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 1000))));
        res.status(429).json({ error: "Rate limit exceeded" });
        return;
      }
      res.status(401).json({ error: "Unauthorized", hint: "Send Authorization: Bearer <api key>" });
      return;
    }

    // Rate limiting — only tool calls consume units; handshake is free.
    const weight = requestWeight(req.body);
    const decision = weight > 0 ? limiter.consume(client.id, weight) : limiter.peek(client.id);

    res.setHeader("RateLimit-Limit", String(decision.limit));
    res.setHeader("RateLimit-Remaining", String(decision.remaining));
    res.setHeader("RateLimit-Reset", new Date(decision.resetAt).toISOString());

    if (!decision.allowed) {
      trackRateLimitHit({ clientId: client.id, limit: decision.limit, weight });
      const retryAfter = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Rate limit exceeded", retryAfter });
      return;
    }

    // Fresh, stateless server + transport per request.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOL_DEFINITIONS] }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name;
      if (!isToolName(name)) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
      const result = await service.handleToolCall(name, request.params.arguments, {
        clientId: client.id,
        rateLimitRemaining: decision.remaining,
        rateLimitLimit: decision.limit,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        ...(result.success === false ? { isError: true } : {}),
      };
    });

    // Release per-request resources once the response is done.
    res.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP handler error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  };
}
