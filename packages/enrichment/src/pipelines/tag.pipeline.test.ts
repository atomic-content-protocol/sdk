import { describe, it, expect } from 'vitest';
import { TagPipeline } from './tag.pipeline.js';
import type { IEnrichmentProvider } from '../providers/provider.interface.js';
import type { ACO } from '@atomic-content-protocol/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeACO(overrides: Partial<Record<string, unknown>> = {}): ACO {
  return {
    frontmatter: {
      id: 'test-id',
      title: 'Test Title',
      ...overrides,
    },
    body: 'This is the body text about AI and protocol design.',
  };
}

function makeMockProvider(response: string): IEnrichmentProvider {
  return {
    name: 'mock',
    model: 'mock-model',
    complete: async () => response,
    structuredComplete: async () => ({} as any),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagPipeline', () => {
  const pipeline = new TagPipeline();

  describe('extracts tags', () => {
    it('sets frontmatter.tags from provider response', async () => {
      const aco = makeACO();
      const provider = makeMockProvider('["ai", "protocol"]');

      const result = await pipeline.enrich(aco, provider);

      expect(result.aco.frontmatter['tags']).toEqual(['ai', 'protocol']);
    });

    it('adds a provenance entry for "tags"', async () => {
      const aco = makeACO();
      const provider = makeMockProvider('["ai", "protocol"]');

      const result = await pipeline.enrich(aco, provider);

      const provenance = result.aco.frontmatter['provenance'] as Record<string, unknown>;
      expect(provenance).toBeDefined();
      expect(provenance['tags']).toBeDefined();
    });

    it('is lenient about surrounding text in the JSON response', async () => {
      const aco = makeACO();
      // Response with surrounding text
      const provider = makeMockProvider('Sure! Here are the tags: ["acp", "open-standard", "llm"]');

      const result = await pipeline.enrich(aco, provider);
      expect(result.aco.frontmatter['tags']).toEqual(['acp', 'open-standard', 'llm']);
    });

    it('leaves the ACO untouched (no tags, no provenance) when the response has no JSON array', async () => {
      const aco = makeACO();
      const provider = makeMockProvider('no json here');

      const result = await pipeline.enrich(aco, provider);
      expect(result.aco.frontmatter['tags']).toBeUndefined();
      expect(result.aco.frontmatter['provenance']).toBeUndefined();
      expect(result.confidence).toBe(0);
    });

    it('does not poison idempotency: a failed run is retried on the next call', async () => {
      const aco = makeACO();
      const failed = await pipeline.enrich(aco, makeMockProvider('garbage'));
      const retried = await pipeline.enrich(failed.aco, makeMockProvider('["ai"]'));
      expect(retried.aco.frontmatter['tags']).toEqual(['ai']);
    });

    it('parses arrays inside fenced code blocks', async () => {
      const result = await pipeline.enrich(makeACO(), makeMockProvider('```json\n["a", "b"]\n```'));
      expect(result.aco.frontmatter['tags']).toEqual(['a', 'b']);
    });

    it('normalises tags to lowercase hyphenated and de-duplicates', async () => {
      const result = await pipeline.enrich(makeACO(), makeMockProvider('["AI", "ai", "Machine Learning"]'));
      expect(result.aco.frontmatter['tags']).toEqual(['ai', 'machine-learning']);
    });

    it('truncates tags to a maximum of 7', async () => {
      const aco = makeACO();
      const provider = makeMockProvider('["a","b","c","d","e","f","g","h","i"]');

      const result = await pipeline.enrich(aco, provider);
      expect((result.aco.frontmatter['tags'] as string[]).length).toBeLessThanOrEqual(7);
    });
  });

  describe('idempotency (skip)', () => {
    it('returns the ACO unchanged when tags AND provenance already exist', async () => {
      const existingTags = ['existing'];
      const aco = makeACO({
        tags: existingTags,
        provenance: { tags: { model: 'old-model', timestamp: '2024-01-01', confidence: 0.9 } },
      });
      const provider = makeMockProvider('["new-tag"]');

      const result = await pipeline.enrich(aco, provider);

      // Should NOT have been changed
      expect(result.aco.frontmatter['tags']).toEqual(existingTags);
      expect(result.model).toBe('skipped');
    });
  });

  describe('force overwrite', () => {
    it('overwrites existing tags when force: true', async () => {
      const aco = makeACO({
        tags: ['old-tag'],
        provenance: { tags: { model: 'old-model', timestamp: '2024-01-01', confidence: 0.9 } },
      });
      const provider = makeMockProvider('["new-tag"]');

      const result = await pipeline.enrich(aco, provider, { force: true });

      expect(result.aco.frontmatter['tags']).toEqual(['new-tag']);
      expect(result.model).toBe('mock-model');
    });
  });

  describe('never overwrites human tags', () => {
    it('skips when tags exist without a provenance entry (human-authored)', async () => {
      const aco = makeACO({ tags: ['human-tag'] });
      const provider = makeMockProvider('["ai-tag"]');

      const result = await pipeline.enrich(aco, provider);

      expect(result.aco.frontmatter['tags']).toEqual(['human-tag']);
      expect(result.model).toBe('skipped');
    });

    it('overwrites human tags only with force', async () => {
      const aco = makeACO({ tags: ['human-tag'] });
      const result = await pipeline.enrich(aco, makeMockProvider('["ai-tag"]'), { force: true });
      expect(result.aco.frontmatter['tags']).toEqual(['ai-tag']);
    });

    it('re-enriches when tags is an empty array', async () => {
      const aco = makeACO({ tags: [] });
      const result = await pipeline.enrich(aco, makeMockProvider('["ai-tag"]'));
      expect(result.aco.frontmatter['tags']).toEqual(['ai-tag']);
    });
  });
});
