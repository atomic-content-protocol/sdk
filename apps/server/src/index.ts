import "dotenv/config";
import { initPostHog, shutdownPostHog } from "./analytics.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
initPostHog(config.posthogApiKey, config.posthogHost);

const app = createApp(config);
const server = app.listen(config.port, () => {
  console.log(`ACP MCP Server v${config.version} listening on port ${config.port}`);
  console.log(`MCP endpoint: POST /mcp  |  Health: GET /health`);
  console.log(`Quality tier: ${config.quality}  |  Rate limit: ${config.rateLimitPerHour} units/hour/client`);
  console.log(
    `Auth: ${config.apiKeys.length > 0 ? `bearer (${config.apiKeys.length} keys)` : "none"}  |  Daily cap: ${Number.isFinite(config.dailyCostCapUsd) ? `$${config.dailyCostCapUsd}` : "off"}`
  );
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received. Shutting down gracefully...`);
  const forceExit = setTimeout(() => process.exit(1), 10_000).unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await shutdownPostHog();
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
