import { describe, it, expect, vi } from 'vitest';
import { ProviderRouter } from './provider-router.js';
import type { IEnrichmentProvider } from '../providers/provider.interface.js';

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function createMockProvider(
  name: string,
  options?: { shouldFail?: boolean }
): IEnrichmentProvider {
  return {
    name,
    model: `mock-${name}`,
    complete: async (prompt) => {
      if (options?.shouldFail) throw new Error(`${name} failed`);
      return `response from ${name}`;
    },
    structuredComplete: async (prompt, schema) => {
      if (options?.shouldFail) throw new Error(`${name} failed`);
      return { tags: ['test'], summary: 'test summary' } as any;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderRouter', () => {
  describe('uses first provider', () => {
    it('routes the call to the first provider when it is healthy', async () => {
      const p1 = createMockProvider('primary');
      const p2 = createMockProvider('secondary');
      const router = new ProviderRouter([p1, p2]);

      const result = await router.complete('hello');
      expect(result).toBe('response from primary');
    });

    it('exposes the first provider name and model via IEnrichmentProvider fields', () => {
      const p1 = createMockProvider('alpha');
      const p2 = createMockProvider('beta');
      const router = new ProviderRouter([p1, p2]);
      expect(router.name).toBe('alpha');
      expect(router.model).toBe('mock-alpha');
    });
  });

  describe('fallback on failure', () => {
    it('falls back to the second provider when the first fails', async () => {
      const p1 = createMockProvider('bad', { shouldFail: true });
      const p2 = createMockProvider('good');
      const router = new ProviderRouter([p1, p2], { failureThreshold: 1 });

      const result = await router.complete('hello');
      expect(result).toBe('response from good');
    });

    it('calls onProviderFailure with the failing provider name', async () => {
      const onProviderFailure = vi.fn();
      const p1 = createMockProvider('bad', { shouldFail: true });
      const p2 = createMockProvider('good');
      const router = new ProviderRouter([p1, p2], {
        failureThreshold: 1,
        onProviderFailure,
      });

      await router.complete('hello');
      expect(onProviderFailure).toHaveBeenCalledWith('bad', expect.any(Error));
    });
  });

  describe('all providers fail', () => {
    it('throws when every provider is exhausted', async () => {
      const p1 = createMockProvider('bad1', { shouldFail: true });
      const p2 = createMockProvider('bad2', { shouldFail: true });
      const router = new ProviderRouter([p1, p2], { failureThreshold: 1 });

      await expect(router.complete('hello')).rejects.toThrow(
        /All providers exhausted/
      );
    });

    it('includes tried provider names in the error message', async () => {
      const p1 = createMockProvider('alpha', { shouldFail: true });
      const p2 = createMockProvider('beta', { shouldFail: true });
      const router = new ProviderRouter([p1, p2], { failureThreshold: 1 });

      await expect(router.complete('hello')).rejects.toThrow(/alpha/);
    });
  });

  describe('skips OPEN circuits', () => {
    it('skips a provider whose circuit breaker is OPEN and uses the next one', async () => {
      // failureThreshold: 1 so a single failure trips the circuit
      const p1 = createMockProvider('flaky', { shouldFail: true });
      const p2 = createMockProvider('stable');
      const router = new ProviderRouter([p1, p2], {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
      });

      // First call: p1 fails, trips circuit, falls back to p2
      const result1 = await router.complete('first call');
      expect(result1).toBe('response from stable');

      // Second call: p1's circuit is OPEN, router skips it directly to p2
      const result2 = await router.complete('second call');
      expect(result2).toBe('response from stable');
    });
  });

  describe('structuredComplete', () => {
    it('delegates structuredComplete to the first healthy provider', async () => {
      const p1 = createMockProvider('primary');
      const router = new ProviderRouter([p1]);
      const result = await router.structuredComplete('prompt', {
        name: 'test',
        description: 'test schema',
        parameters: {},
      });
      expect(result).toMatchObject({ tags: ['test'], summary: 'test summary' });
    });
  });

  describe('embed', () => {
    it('throws when no providers support embed', async () => {
      const p1 = createMockProvider('no-embed');
      const router = new ProviderRouter([p1]);
      await expect(router.embed('text')).rejects.toThrow(/embeddings/);
    });

    it('calls embed on a provider that supports it', async () => {
      const vector = [0.1, 0.2, 0.3];
      const p1: IEnrichmentProvider = {
        ...createMockProvider('embedder'),
        embed: async () => vector,
      };
      const router = new ProviderRouter([p1]);
      const result = await router.embed('some text');
      expect(result).toEqual(vector);
    });
  });
});
