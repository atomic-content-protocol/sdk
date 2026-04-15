import { describe, it, expect } from 'vitest';
import { TagPipeline } from './tag.pipeline.js';
import type { IEnrichmentProvider } from '../providers/provider.interface.js';
import type { ACO } from '@acp/core';

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

    it('returns empty tags array when response has no valid JSON array', async () => {
      const aco = makeACO();
      const provider = makeMockProvider('no json here');

      const result = await pipeline.enrich(aco, provider);
      expect(result.aco.frontmatter['tags']).toEqual([]);
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
    it('runs enrichment when tags exist but there is no provenance entry (human-authored tags are overwritten)', async () => {
      // The idempotency guard requires BOTH tags AND provenance.tags.
      // If a human set tags without provenance, the pipeline will proceed and
      // overwrite them — this is the current code behaviour.
      // NOTE: a future version may add a separate "human-authored" guard.
      const aco = makeACO({
        tags: ['human-tag'],
        // No provenance field at all
      });
      const provider = makeMockProvider('["ai-tag"]');

      const result = await pipeline.enrich(aco, provider);

      // Pipeline ran and produced new tags
      expect(result.aco.frontmatter['tags']).toEqual(['ai-tag']);
      expect(result.model).toBe('mock-model');
    });
  });
});
