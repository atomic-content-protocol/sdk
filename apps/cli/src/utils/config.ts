import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ACPConfig {
  vault_path: string;
  author?: { id: string; name: string };
  enrichment?: {
    anthropic?: { api_key?: string; model?: string };
    openai?: { api_key?: string; model?: string };
    ollama?: { base_url?: string; model?: string };
  };
}

export async function loadConfig(vaultPath?: string): Promise<ACPConfig> {
  const path = vaultPath || process.cwd();
  const configPath = join(path, '.acp', 'config.json');

  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as ACPConfig;
  } catch {
    // Default config — use current directory as vault, check env vars for API keys
    return {
      vault_path: path,
      enrichment: {
        anthropic: { api_key: process.env['ANTHROPIC_API_KEY'] },
        openai: { api_key: process.env['OPENAI_API_KEY'] },
      },
    };
  }
}
