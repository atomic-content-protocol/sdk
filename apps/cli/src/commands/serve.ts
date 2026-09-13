import { Command } from "commander";
import { ACPMCPServer } from "@atomic-content-protocol/mcp";
import { loadConfig } from "../utils/config.js";
import { createStorage } from "../utils/storage.js";
import { resolveProviderConfig } from "../utils/enrichment.js";
import { PKG } from "../utils/pkg.js";

export const serveCommand = new Command("serve")
  .description("Start the MCP server over the current vault (stdio transport)")
  .action(async (_options: Record<string, never>, cmd: Command) => {
    const { config } = await loadConfig(cmd.optsWithGlobals()["vault"] as string | undefined);
    const storage = createStorage(config);
    const providers = resolveProviderConfig(config);

    const server = new ACPMCPServer({
      storage,
      enrichment: providers ? { providers } : undefined,
      server: { name: "acp-server", version: PKG.version },
    });

    // All output must go to stderr — stdout is JSON-RPC.
    process.stderr.write(`ACP MCP Server v${PKG.version} starting...\n`);
    process.stderr.write(`Vault: ${config.vault_path}\n`);
    process.stderr.write(`Enrichment: ${providers ? `enabled (${providers.quality ?? "fast"} tier)` : "disabled"}\n`);

    await server.start();
  });
