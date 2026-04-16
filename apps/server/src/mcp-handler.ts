import type { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { checkRateLimit } from './rate-limit.js';
import { getTools, handleToolCall } from './tools.js';

export async function mcpHandler(req: Request, res: Response) {
  // Rate limiting by IP
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rateLimit = checkRateLimit(ip);

  res.setHeader('RateLimit-Limit', process.env.RATE_LIMIT_PER_HOUR || '50');
  res.setHeader('RateLimit-Remaining', rateLimit.remaining.toString());
  res.setHeader('RateLimit-Reset', new Date(rateLimit.resetAt).toISOString());

  if (!rateLimit.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
    });
    return;
  }

  try {
    // Create fresh transport per request (stateless)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless -- no sessions
    });

    // Create fresh MCP server per request
    const server = new Server(
      { name: 'acp-enrichment-server', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    // Register tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: getTools() };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await handleToolCall(request.params.name, request.params.arguments);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    });

    // Connect server to transport
    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP handler error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
