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

/** Identify the caller: bearer token when auth is on, else the (proxy-resolved) IP. */
export function resolveClient(req: Request, config: ServerConfig): { id: string; authorized: boolean } {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (config.apiKeys.length > 0) {
    const ok = token.length > 0 && config.apiKeys.includes(token);
    return { id: ok ? `key:${token}` : "unauthorized", authorized: ok };
  }
  return { id: `ip:${req.ip || req.socket.remoteAddress || "unknown"}`, authorized: true };
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
      trackRateLimitHit({ clientId: client.id, requestsInWindow: decision.limit });
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
