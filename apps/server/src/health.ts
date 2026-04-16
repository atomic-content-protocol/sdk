import type { Request, Response } from 'express';

export function healthHandler(_req: Request, res: Response) {
  res.json({
    status: 'ok',
    service: 'acp-mcp-server',
    version: '0.1.0',
    enrichment: !!process.env.ANTHROPIC_API_KEY,
  });
}
