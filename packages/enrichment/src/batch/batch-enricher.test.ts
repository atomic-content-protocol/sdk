import { describe, it, expect, vi } from 'vitest';
import { BatchEnricher } from './batch-enricher.js';
import type { IEnrichmentProvider } from '../providers/provider.interface.js';
import type { IEnrichmentPipeline, EnrichmentResult, EnrichmentOptions } from '../pipelines/pipeline.interface.js';
import type { ACO } from '@atomic-content-protocol/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeACO(id: string, extraFrontmatter: Record<string, unknown> = {}): ACO {
  return {
    frontmatter: { id, title: `ACO ${id}`, ...extraFrontmatter },
    body: `Body of ${id}`,
  };
}

const NOOP_PROVIDER: IEnrichmentProvider = {
  name: 'noop',
  model: 'noop-model',
  complete: async () => '',
  structuredComplete: async () => ({} as any),
};

/** A pipeline that stamps a field into frontmatter to prove it ran. */
function makeStampPipeline(
  fieldName: string,
  value: unknown = true
): IEnrichmentPipeline {
  return {
    name: `stamp-${fieldName}`,
    field: fieldName,
    enrich: async (aco, _provider, _options): Promise<EnrichmentResult> => ({
      aco: {
        frontmatter: { ...aco.frontmatter, [fieldName]: value },
        body: aco.body,
      },
      fieldUpdated: fieldName,
      confidence: 1.0,
      model: 'stamp',
    }),
  };
}

/** A pipeline that always throws. */
function makeFailingPipeline(): IEnrichmentPipeline {
  return {
    name: 'failing',
    field: 'none',
    enrich: async () => {
      throw new Error('pipeline exploded');
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BatchEnricher', () => {
  describe('enrichOne', () => {
    it('enriches a single ACO by passing it through all pipelines in sequence', async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [
        makeStampPipeline('step1', 'a'),
        makeStampPipeline('step2', 'b'),
      ]);

      const aco = makeACO('aco-1');
      const result = await enricher.enrichOne(aco);

      expect(result.frontmatter['step1']).toBe('a');
      expect(result.frontmatter['step2']).toBe('b');
    });

    it('feeds each pipeline the output of the previous one', async () => {
      // Second pipeline reads what first pipeline wrote
      const appendPipeline: IEnrichmentPipeline = {
        name: 'append',
        field: 'chain',
        enrich: async (aco): Promise<EnrichmentResult> => ({
          aco: {
            frontmatter: {
              ...aco.frontmatter,
              chain: `${aco.frontmatter['chain'] ?? ''}>step2`,
            },
            body: aco.body,
          },
          fieldUpdated: 'chain',
          confidence: 1,
          model: 'stamp',
        }),
      };

      const initPipeline: IEnrichmentPipeline = {
        name: 'init',
        field: 'chain',
        enrich: async (aco): Promise<EnrichmentResult> => ({
          aco: {
            frontmatter: { ...aco.frontmatter, chain: 'step1' },
            body: aco.body,
          },
          fieldUpdated: 'chain',
          confidence: 1,
          model: 'stamp',
        }),
      };

      const enricher = new BatchEnricher(NOOP_PROVIDER, [initPipeline, appendPipeline]);
      const result = await enricher.enrichOne(makeACO('x'));
      expect(result.frontmatter['chain']).toBe('step1>step2');
    });
  });

  describe('enrichMany', () => {
    it('enriches multiple ACOs and preserves input order', async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [makeStampPipeline('done')]);
      const acos = [makeACO('a'), makeACO('b'), makeACO('c')];

      const { results, errors } = await enricher.enrichMany(acos);

      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(3);
      expect(results[0]!.frontmatter['id']).toBe('a');
      expect(results[1]!.frontmatter['id']).toBe('b');
      expect(results[2]!.frontmatter['id']).toBe('c');
    });

    it('calls onProgress after each ACO with correct counts', async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [makeStampPipeline('done')]);
      const acos = [makeACO('a'), makeACO('b'), makeACO('c')];
      const progress: Array<[number, number]> = [];

      await enricher.enrichMany(acos, {
        onProgress: (completed, total) => progress.push([completed, total]),
      });

      expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    it('handles errors gracefully: failed ACO is captured, others succeed', async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [makeFailingPipeline()]);
      const acos = [makeACO('a'), makeACO('b')];

      const { results, errors } = await enricher.enrichMany(acos);

      // Both failed (the only pipeline always throws)
      expect(errors).toHaveLength(2);
      expect(results).toHaveLength(0);
      expect(errors[0]!.error).toMatch(/pipeline exploded/);
    });

    it('succeeds for healthy ACOs even when one ACO fails', async () => {
      // Mix: first pipeline is fine, second fails only for specific ACO
      let callCount = 0;
      const selectiveFail: IEnrichmentPipeline = {
        name: 'selective',
        field: 'test',
        enrich: async (aco): Promise<EnrichmentResult> => {
          callCount++;
          if (aco.frontmatter['id'] === 'bad') throw new Error('bad aco');
          return {
            aco: { frontmatter: { ...aco.frontmatter, enriched: true }, body: aco.body },
            fieldUpdated: 'test',
            confidence: 1,
            model: 'stamp',
          };
        },
      };

      const enricher = new BatchEnricher(NOOP_PROVIDER, [selectiveFail]);
      const acos = [makeACO('good1'), makeACO('bad'), makeACO('good2')];

      const { results, errors } = await enricher.enrichMany(acos);

      expect(results).toHaveLength(2);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.id).toBe('bad');
      expect(errors[0]!.error).toMatch(/bad aco/);

      // Successful results maintain order
      expect(results[0]!.frontmatter['id']).toBe('good1');
      expect(results[1]!.frontmatter['id']).toBe('good2');
    });

    it('uses index-N as id when ACO has no id field', async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [makeFailingPipeline()]);
      const aco: ACO = { frontmatter: { title: 'No ID' }, body: 'body' };

      const { errors } = await enricher.enrichMany([aco]);

      expect(errors[0]!.id).toBe('index-0');
    });

    it('passes options through to pipelines', async () => {
      let receivedOptions: EnrichmentOptions | undefined;
      const capturePipeline: IEnrichmentPipeline = {
        name: 'capture',
        field: 'test',
        enrich: async (aco, _provider, options): Promise<EnrichmentResult> => {
          receivedOptions = options;
          return {
            aco,
            fieldUpdated: 'test',
            confidence: 1,
            model: 'stamp',
          };
        },
      };

      const enricher = new BatchEnricher(NOOP_PROVIDER, [capturePipeline]);
      await enricher.enrichMany([makeACO('x')], { force: true });

      expect(receivedOptions?.force).toBe(true);
    });
  });
});
