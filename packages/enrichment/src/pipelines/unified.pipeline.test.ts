import { describe, it, expect, vi } from 'vitest';
import { UnifiedPipeline } from './unified.pipeline.js';
import type { IEnrichmentProvider } from '../providers/provider.interface.js';
import type { ACO } from '@acp/core';
import type { UnifiedEnrichmentOutput } from '../utils/prompts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeACO(overrides: Partial<Record<string, unknown>> = {}): ACO {
  return {
    frontmatter: {
      id: 'test-id',
      title: 'Test ACO',
      ...overrides,
    },
    body: 'Content about the Atomic Content Protocol and machine-readable knowledge.',
  };
}

const MOCK_OUTPUT: UnifiedEnrichmentOutput = {
  tags: ['ai', 'protocol', 'knowledge'],
  summary: 'This is a test summary. It describes the content accurately.',
  classification: 'reference',
  key_entities: [{ type: 'technology', name: 'ACP', confidence: 0.95 }],
  language: 'en',
};

function makeMockProvider(
  output: UnifiedEnrichmentOutput = MOCK_OUTPUT,
  options?: { shouldTrackCalls?: boolean }
): IEnrichmentProvider & { callCount: number } {
  let callCount = 0;
  return {
    name: 'mock',
    model: 'mock-model',
    complete: async () => '',
    structuredComplete: async () => {
      callCount++;
      return output as any;
    },
    get callCount() { return callCount; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnifiedPipeline', () => {
  const pipeline = new UnifiedPipeline();

  describe('single call enriches all fields', () => {
    it('sets tags, summary, classification, key_entities, and language', async () => {
      const aco = makeACO();
      const provider = makeMockProvider();

      const result = await pipeline.enrich(aco, provider);
      const fm = result.aco.frontmatter;

      expect(fm['tags']).toEqual(MOCK_OUTPUT.tags);
      expect(fm['summary']).toBe(MOCK_OUTPUT.summary);
      expect(fm['classification']).toBe(MOCK_OUTPUT.classification);
      expect(fm['key_entities']).toEqual(MOCK_OUTPUT.key_entities);
      expect(fm['language']).toBe(MOCK_OUTPUT.language);
    });

    it('makes exactly one provider call', async () => {
      const aco = makeACO();
      const provider = makeMockProvider();

      await pipeline.enrich(aco, provider);
      expect(provider.callCount).toBe(1);
    });
  });

  describe('provenance recorded for each field', () => {
    it('writes a provenance entry for every enriched field', async () => {
      const aco = makeACO();
      const provider = makeMockProvider();

      const result = await pipeline.enrich(aco, provider);
      const prov = result.aco.frontmatter['provenance'] as Record<string, unknown>;

      expect(prov).toBeDefined();
      expect(prov['tags']).toBeDefined();
      expect(prov['summary']).toBeDefined();
      expect(prov['classification']).toBeDefined();
      expect(prov['key_entities']).toBeDefined();
      expect(prov['language']).toBeDefined();
    });

    it('provenance records include model, timestamp, and confidence', async () => {
      const aco = makeACO();
      const provider = makeMockProvider();

      const result = await pipeline.enrich(aco, provider);
      const prov = result.aco.frontmatter['provenance'] as Record<string, unknown>;
      const tagsProv = prov['tags'] as Record<string, unknown>;

      expect(tagsProv['model']).toBe('mock-model');
      expect(typeof tagsProv['timestamp']).toBe('string');
      expect(typeof tagsProv['confidence']).toBe('number');
    });
  });

  describe('skip all if fully enriched', () => {
    it('does not call the provider when all fields have provenance', async () => {
      const fullProvenance = {
        tags: { model: 'old', timestamp: '2024-01-01', confidence: 0.9 },
        summary: { model: 'old', timestamp: '2024-01-01', confidence: 0.9 },
        classification: { model: 'old', timestamp: '2024-01-01', confidence: 0.9 },
        key_entities: { model: 'old', timestamp: '2024-01-01', confidence: 0.8 },
        language: { model: 'old', timestamp: '2024-01-01', confidence: 0.95 },
      };
      const aco = makeACO({
        tags: ['existing'],
        summary: 'existing summary',
        classification: 'notes',
        key_entities: [],
        language: 'en',
        provenance: fullProvenance,
      });
      const provider = makeMockProvider();

      const result = await pipeline.enrich(aco, provider);

      expect(provider.callCount).toBe(0);
      expect(result.model).toBe('skipped');
    });
  });

  describe('partial enrichment', () => {
    it('enriches missing fields while preserving fields that already have provenance', async () => {
      // Only tags have provenance; summary, classification, key_entities, language are missing
      const aco = makeACO({
        tags: ['preserved-tag'],
        provenance: {
          tags: { model: 'old', timestamp: '2024-01-01', confidence: 0.9 },
        },
      });
      const provider = makeMockProvider();

      const result = await pipeline.enrich(aco, provider);

      // tags should be preserved (not overwritten)
      expect(result.aco.frontmatter['tags']).toEqual(['preserved-tag']);
      // other fields should be filled in
      expect(result.aco.frontmatter['summary']).toBe(MOCK_OUTPUT.summary);
      expect(result.aco.frontmatter['classification']).toBe(MOCK_OUTPUT.classification);
      expect(result.aco.frontmatter['language']).toBe(MOCK_OUTPUT.language);

      // provider was called (partial fields needed enrichment)
      expect(provider.callCount).toBe(1);
    });
  });

  describe('force enriches everything', () => {
    it('overwrites all fields even when full provenance already exists', async () => {
      const fullProvenance = {
        tags: { model: 'old', timestamp: '2024-01-01', confidence: 0.9 },
        summary: { model: 'old', timestamp: '2024-01-01', confidence: 0.9 },
        classification: { model: 'old', timestamp: '2024-01-01', confidence: 0.9 },
        key_entities: { model: 'old', timestamp: '2024-01-01', confidence: 0.8 },
        language: { model: 'old', timestamp: '2024-01-01', confidence: 0.95 },
      };
      const aco = makeACO({
        tags: ['old-tag'],
        summary: 'old summary',
        classification: 'notes',
        key_entities: [],
        language: 'de',
        provenance: fullProvenance,
      });
      const provider = makeMockProvider();

      const result = await pipeline.enrich(aco, provider, { force: true });

      expect(result.aco.frontmatter['tags']).toEqual(MOCK_OUTPUT.tags);
      expect(result.aco.frontmatter['summary']).toBe(MOCK_OUTPUT.summary);
      expect(result.aco.frontmatter['language']).toBe(MOCK_OUTPUT.language);
      expect(provider.callCount).toBe(1);
    });
  });
});
