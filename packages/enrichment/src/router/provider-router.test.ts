import { describe, expect, it, vi } from "vitest";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import { ProviderRouter } from "./provider-router.js";

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function createMockProvider(name: string, options?: { shouldFail?: boolean }): IEnrichmentProvider {
  return {
    name,
    model: `mock-${name}`,
    complete: async (_prompt) => {
      if (options?.shouldFail) throw new Error(`${name} failed`);
      return `response from ${name}`;
    },
    structuredComplete: async (_prompt, _schema) => {
      if (options?.shouldFail) throw new Error(`${name} failed`);
      return { tags: ["test"], summary: "test summary" } as any;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProviderRouter", () => {
  describe("uses first provider", () => {
    it("routes the call to the first provider when it is healthy", async () => {
      const p1 = createMockProvider("primary");
      const p2 = createMockProvider("secondary");
      const router = new ProviderRouter([p1, p2]);

      const result = await router.complete("hello");
      expect(result).toBe("response from primary");
    });

    it("exposes the first provider name and model via IEnrichmentProvider fields", () => {
      const p1 = createMockProvider("alpha");
      const p2 = createMockProvider("beta");
      const router = new ProviderRouter([p1, p2]);
      expect(router.name).toBe("alpha");
      expect(router.model).toBe("mock-alpha");
    });
  });

  describe("fallback on failure", () => {
    it("falls back to the second provider when the first fails", async () => {
      const p1 = createMockProvider("bad", { shouldFail: true });
      const p2 = createMockProvider("good");
      const router = new ProviderRouter([p1, p2], { failureThreshold: 1 });

      const result = await router.complete("hello");
      expect(result).toBe("response from good");
    });

    it("calls onProviderFailure with the failing provider name", async () => {
      const onProviderFailure = vi.fn();
      const p1 = createMockProvider("bad", { shouldFail: true });
      const p2 = createMockProvider("good");
      const router = new ProviderRouter([p1, p2], {
        failureThreshold: 1,
        onProviderFailure,
      });

      await router.complete("hello");
      expect(onProviderFailure).toHaveBeenCalledWith("bad", expect.any(Error));
    });
  });

  describe("all providers fail", () => {
    it("throws when every provider is exhausted", async () => {
      const p1 = createMockProvider("bad1", { shouldFail: true });
      const p2 = createMockProvider("bad2", { shouldFail: true });
      const router = new ProviderRouter([p1, p2], { failureThreshold: 1 });

      await expect(router.complete("hello")).rejects.toThrow(/All providers exhausted/);
    });

    it("includes tried provider names in the error message", async () => {
      const p1 = createMockProvider("alpha", { shouldFail: true });
      const p2 = createMockProvider("beta", { shouldFail: true });
      const router = new ProviderRouter([p1, p2], { failureThreshold: 1 });

      await expect(router.complete("hello")).rejects.toThrow(/alpha/);
    });
  });

  describe("skips OPEN circuits", () => {
    it("skips a provider whose circuit breaker is OPEN and uses the next one", async () => {
      // failureThreshold: 1 so a single failure trips the circuit
      const p1 = createMockProvider("flaky", { shouldFail: true });
      const p2 = createMockProvider("stable");
      const router = new ProviderRouter([p1, p2], {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
      });

      // First call: p1 fails, trips circuit, falls back to p2
      const result1 = await router.complete("first call");
      expect(result1).toBe("response from stable");

      // Second call: p1's circuit is OPEN, router skips it directly to p2
      const result2 = await router.complete("second call");
      expect(result2).toBe("response from stable");
    });
  });

  describe("structuredComplete", () => {
    it("delegates structuredComplete to the first healthy provider", async () => {
      const p1 = createMockProvider("primary");
      const router = new ProviderRouter([p1]);
      const result = await router.structuredComplete("prompt", {
        name: "test",
        description: "test schema",
        parameters: {},
      });
      expect(result).toMatchObject({ tags: ["test"], summary: "test summary" });
    });
  });

  describe("embed", () => {
    it("throws when no providers support embed", async () => {
      const p1 = createMockProvider("no-embed");
      const router = new ProviderRouter([p1]);
      await expect(router.embed("text")).rejects.toThrow(/embeddings/);
    });

    it("calls embed on a provider that supports it", async () => {
      const vector = [0.1, 0.2, 0.3];
      const p1: IEnrichmentProvider = {
        ...createMockProvider("embedder"),
        embed: async () => vector,
      };
      const router = new ProviderRouter([p1]);
      const result = await router.embed("some text");
      expect(result).toEqual(vector);
    });
  });
});

describe("ProviderRouter — metadata, signals, skips", () => {
  it("structuredCompleteWithMeta reports the provider that actually answered after fallback", async () => {
    const p1 = createMockProvider("primary", { shouldFail: true });
    const p2 = createMockProvider("secondary");
    const router = new ProviderRouter([p1, p2]);
    const meta = await router.structuredCompleteWithMeta("p", { name: "x", description: "", parameters: {} });
    expect(meta.provider).toBe("secondary");
    expect(meta.model).toBe("mock-secondary");
    // The identity getter still describes the primary — pipelines must use WithMeta.
    expect(router.model).toBe("mock-primary");
  });

  it("embedWithMeta reports the embedding model, not the chat model", async () => {
    const p: IEnrichmentProvider = {
      ...createMockProvider("e"),
      embeddingModel: "embed-x",
      embed: async () => [1],
    };
    const router = new ProviderRouter([p]);
    expect((await router.embedWithMeta("t")).model).toBe("embed-x");
    expect(router.embeddingModel).toBe("embed-x");
  });

  it("forwards the breaker timeout signal to the provider", async () => {
    let received: AbortSignal | undefined;
    const p: IEnrichmentProvider = {
      ...createMockProvider("sig"),
      complete: async (_prompt, options) => {
        received = options?.signal;
        return "ok";
      },
    };
    await new ProviderRouter([p]).complete("x");
    expect(received).toBeInstanceOf(AbortSignal);
  });

  it("merges a caller-supplied signal with the breaker signal", async () => {
    let received: AbortSignal | undefined;
    const p: IEnrichmentProvider = {
      ...createMockProvider("sig"),
      complete: async (_prompt, options) => {
        received = options?.signal;
        return "ok";
      },
    };
    const controller = new AbortController();
    await new ProviderRouter([p]).complete("x", { signal: controller.signal });
    expect(received?.aborted).toBe(false);
    controller.abort();
    expect(received?.aborted).toBe(true);
  });

  it("calls onProviderSkipped (not onProviderFailure) for OPEN circuits", async () => {
    const onProviderSkipped = vi.fn();
    const onProviderFailure = vi.fn();
    const p1 = createMockProvider("flaky", { shouldFail: true });
    const p2 = createMockProvider("stable");
    const router = new ProviderRouter([p1, p2], {
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
      onProviderSkipped,
      onProviderFailure,
    });
    await router.complete("a");
    expect(onProviderFailure).toHaveBeenCalledTimes(1);
    await router.complete("b");
    expect(onProviderSkipped).toHaveBeenCalledWith("flaky", expect.stringMatching(/OPEN/));
    expect(onProviderFailure).toHaveBeenCalledTimes(1);
    expect(router.providers[0]!.state).toBe("OPEN");
  });

  it("times out a hung provider and falls back", async () => {
    const hung: IEnrichmentProvider = {
      ...createMockProvider("hung"),
      complete: (_p, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    const p2 = createMockProvider("stable");
    const router = new ProviderRouter([hung, p2], { requestTimeoutMs: 10 });
    expect(await router.complete("x")).toBe("response from stable");
  });
});
