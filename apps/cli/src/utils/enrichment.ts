import { ProviderRouter } from '@acp/enrichment';
import type { ProviderConfig } from '@acp/enrichment';
import type { ACPConfig } from './config.js';

export function createRouter(config: ACPConfig): ProviderRouter | null {
  const providerConfig: ProviderConfig = {};

  const apiKey = config.enrichment?.anthropic?.api_key || process.env['ANTHROPIC_API_KEY'];
  if (apiKey) {
    providerConfig.anthropic = { apiKey, model: config.enrichment?.anthropic?.model };
  }

  const openaiKey = config.enrichment?.openai?.api_key || process.env['OPENAI_API_KEY'];
  if (openaiKey) {
    providerConfig.openai = { apiKey: openaiKey, model: config.enrichment?.openai?.model };
  }

  if (config.enrichment?.ollama) {
    providerConfig.ollama = {
      baseUrl: config.enrichment.ollama.base_url,
      model: config.enrichment.ollama.model,
    };
  }

  if (Object.keys(providerConfig).length === 0) return null;

  return ProviderRouter.fromConfig(providerConfig);
}
