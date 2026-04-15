import { describe, it, expect } from 'vitest';
import { EmbedPipeline } from './embed.pipeline.js';
import type { IEnrichmentProvider } from '../providers/provider.interface.js';
import type { ACO } from '@acp/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_VECTOR = [0.1, 0.2, 0.3, 0.4];

function makeACO(overrides: Partial<Record<string, unknown>> = {}): ACO {
  return {
    frontmatter: {
      id: 'test-id',
      title: 'Test Title',
      ...overrides,
    },
    body: 'Some content to embed.',
  };
}

function makeEmbedProvider(): IEnrichmentProvider {
  return {
    name: 'mock-embedder',
    model: 'mock-embed-model',
    complete: async () => '',
    structuredComplete: async () => ({} as any),
    embed: async () => MOCK_VECTOR,
  };
}

function makeNoEmbedProvider(): IEnrichmentProvider {
  return {
    name: 'mock-no-embed',
    model: 'mock-model',
    complete: async () => '',
    structuredComplete: async () => ({} as any),
    // No embed method
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbedPipeline', () => {
  const pipeline = new EmbedPipeline();

  describe('returns embedding in result', () => {
    it('sets result.embedding to the vector returned by the provider', async () => {
      const aco = makeACO();
      const provider = makeEmbedProvider();

      const result = await pipeline.enrich(aco, provider);

      expect(result.embedding).toEqual(MOCK_VECTOR);
    });

    it('does NOT write the embedding vector into frontmatter (too large)', async () => {
      const aco = makeACO();
      const provider = makeEmbedProvider();

      const result = await pipeline.enrich(aco, provider);

      expect(result.aco.frontmatter['embedding']).toBeUndefined();
    });

    it('writes a provenance record to frontmatter.provenance.embedding', async () => {
      const aco = makeACO();
      const provider = makeEmbedProvider();

      const result = await pipeline.enrich(aco, provider);
      const prov = result.aco.frontmatter['provenance'] as Record<string, unknown>;

      expect(prov).toBeDefined();
      expect(prov['embedding']).toBeDefined();
    });

    it('records the correct model in the provenance entry', async () => {
      const aco = makeACO();
      const provider = makeEmbedProvider();

      const result = await pipeline.enrich(aco, provider);
      const prov = result.aco.frontmatter['provenance'] as Record<string, unknown>;
      const embProv = prov['embedding'] as Record<string, unknown>;

      expect(embProv['model']).toBe('mock-embed-model');
    });
  });

  describe('throws if no embed() method', () => {
    it('throws a descriptive error when the provider lacks embed()', async () => {
      const aco = makeACO();
      const provider = makeNoEmbedProvider();

      await expect(pipeline.enrich(aco, provider)).rejects.toThrow(
        /does not support embeddings/
      );
    });

    it('includes the provider name in the error message', async () => {
      const aco = makeACO();
      const provider = makeNoEmbedProvider();

      await expect(pipeline.enrich(aco, provider)).rejects.toThrow(
        /mock-no-embed/
      );
    });
  });

  describe('idempotency', () => {
    it('skips embedding if provenance.embedding already exists', async () => {
      let callCount = 0;
      const provider: IEnrichmentProvider = {
        ...makeEmbedProvider(),
        embed: async () => {
          callCount++;
          return MOCK_VECTOR;
        },
      };

      const aco = makeACO({
        provenance: {
          embedding: { model: 'old-model', timestamp: '2024-01-01', confidence: 1.0 },
        },
      });

      const result = await pipeline.enrich(aco, provider);

      expect(callCount).toBe(0);
      expect(result.model).toBe('skipped');
    });

    it('re-embeds when force: true even if provenance exists', async () => {
      let callCount = 0;
      const provider: IEnrichmentProvider = {
        ...makeEmbedProvider(),
        embed: async () => {
          callCount++;
          return MOCK_VECTOR;
        },
      };

      const aco = makeACO({
        provenance: {
          embedding: { model: 'old-model', timestamp: '2024-01-01', confidence: 1.0 },
        },
      });

      const result = await pipeline.enrich(aco, provider, { force: true });

      expect(callCount).toBe(1);
      expect(result.embedding).toEqual(MOCK_VECTOR);
    });

    it('runs embedding if no provenance exists', async () => {
      let callCount = 0;
      const provider: IEnrichmentProvider = {
        ...makeEmbedProvider(),
        embed: async () => {
          callCount++;
          return MOCK_VECTOR;
        },
      };

      const aco = makeACO();

      await pipeline.enrich(aco, provider);
      expect(callCount).toBe(1);
    });
  });
});
