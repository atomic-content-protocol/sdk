# @atomic-content-protocol/enrichment

LLM enrichment pipelines for the [Atomic Content Protocol](https://atomiccontentprotocol.org).

Runs tagging, summarisation, entity extraction, classification, and embedding over ACOs using Anthropic, OpenAI, or Ollama providers.

## Install

```bash
npm install @atomic-content-protocol/enrichment @atomic-content-protocol/core
```

## Quick start

```typescript
import {
  ProviderRouter,
  UnifiedPipeline,
  BatchEnricher,
} from "@atomic-content-protocol/enrichment";

const router = ProviderRouter.fromConfig({
  quality: "fast", // fast (Haiku 4.5 / GPT-5.6 Luna) | balanced | best
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
  openai: { apiKey: process.env.OPENAI_API_KEY! }, // fallback + embeddings
});

const enricher = new BatchEnricher(router, [new UnifiedPipeline()]);
const enriched = await enricher.enrichOne(myACO);
```

## What's in the package

- `providers/` — `AnthropicProvider`, `OpenAIProvider`, `OllamaProvider`
- `router/` — `ProviderRouter`, `CircuitBreaker`
- `pipelines/` — `TagPipeline`, `SummaryPipeline`, `EntityPipeline`, `ClassificationPipeline`, `UnifiedPipeline`, `EmbedPipeline`
- `batch/` — `BatchEnricher` for bulk enrichment (`concurrency` option)
- `utils/` — `estimateEnrichmentCost`, `parseUnifiedOutput` (Zod validation of model output), provenance helpers

Enrichment never overwrites a field that already has a value unless `force: true`; provenance records the model that actually answered after any fallback.

`UnifiedPipeline` runs tags + summary + entities + classification + language in a single LLM call — the cheapest path to a fully enriched ACO.

## Links

- Protocol spec: [atomiccontentprotocol.org](https://atomiccontentprotocol.org)
- Repository: [github.com/atomic-content-protocol/sdk](https://github.com/atomic-content-protocol/sdk)

## Stewardship

The Atomic Content Protocol is an open standard stewarded by [Stacks, Inc](https://www.stacks.inc/) — the company behind [Stacklist](https://stacklist.com).

## License

Apache-2.0
