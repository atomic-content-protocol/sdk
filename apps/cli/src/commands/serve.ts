import { Command } from 'commander';
import { FilesystemAdapter } from '@acp/core';
import { ACPMCPServer } from '@acp/mcp';
import { loadConfig } from '../utils/config.js';

export const serveCommand = new Command('serve')
  .description('Start MCP server for AI agent access')
  .action(async () => {
    const config = await loadConfig();
    const storage = new FilesystemAdapter(config.vault_path);

    // Build provider config from env/config
    const providerConfig: Record<string, unknown> = {};
    const anthropicKey = config.enrichment?.anthropic?.api_key || process.env['ANTHROPIC_API_KEY'];
    if (anthropicKey) providerConfig['anthropic'] = { apiKey: anthropicKey };
    const openaiKey = config.enrichment?.openai?.api_key || process.env['OPENAI_API_KEY'];
    if (openaiKey) providerConfig['openai'] = { apiKey: openaiKey };

    const server = new ACPMCPServer({
      storage,
      enrichment:
        Object.keys(providerConfig).length > 0
          ? { providers: providerConfig as import('@acp/enrichment').ProviderConfig }
          : undefined,
      server: { name: 'acp-server', version: '0.1.0' },
    });

    // All output must go to stderr — stdout is JSON-RPC
    process.stderr.write('ACP MCP Server starting...\n');
    process.stderr.write(`Vault: ${config.vault_path}\n`);
    process.stderr.write(
      `Enrichment: ${Object.keys(providerConfig).length > 0 ? 'enabled' : 'disabled'}\n`
    );

    await server.start();
  });
