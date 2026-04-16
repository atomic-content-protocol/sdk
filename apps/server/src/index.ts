import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { mcpHandler } from './mcp-handler.js';
import { healthHandler } from './health.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Security
app.use(helmet());
app.use(cors());

// Health check (no auth)
app.get('/health', healthHandler);

// MCP endpoint
app.post('/mcp', express.json(), mcpHandler);
app.get('/mcp', (_req, res) => res.status(405).json({ error: 'SSE not supported in stateless mode' }));
app.delete('/mcp', (_req, res) => res.status(200).json({ ok: true }));

// Start
app.listen(PORT, () => {
  console.log(`ACP MCP Server listening on port ${PORT}`);
  console.log(`MCP endpoint: POST /mcp`);
  console.log(`Health: GET /health`);
  console.log(`Rate limit: ${process.env.RATE_LIMIT_PER_HOUR || 50}/hour`);
});
