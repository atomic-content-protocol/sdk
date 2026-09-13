import type { ACO } from "@atomic-content-protocol/core";
import { describe, expect, it } from "vitest";
import type { EnrichmentOptions, EnrichmentResult, IEnrichmentPipeline } from "../pipelines/pipeline.interface.js";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import { BatchEnricher } from "./batch-enricher.js";

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
  name: "noop",
  model: "noop-model",
  complete: async () => "",
  structuredComplete: async () => ({}) as any,
};

/** A pipeline that stamps a field into frontmatter to prove it ran. */
function makeStampPipeline(fieldName: string, value: unknown = true): IEnrichmentPipeline {
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
      model: "stamp",
    }),
  };
}

/** A pipeline that always throws. */
function makeFailingPipeline(): IEnrichmentPipeline {
  return {
    name: "failing",
    field: "none",
    enrich: async () => {
      throw new Error("pipeline exploded");
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BatchEnricher", () => {
  describe("enrichOne", () => {
    it("enriches a single ACO by passing it through all pipelines in sequence", async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [
        makeStampPipeline("step1", "a"),
        makeStampPipeline("step2", "b"),
      ]);

      const aco = makeACO("aco-1");
      const result = await enricher.enrichOne(aco);

      expect(result.frontmatter["step1"]).toBe("a");
      expect(result.frontmatter["step2"]).toBe("b");
    });

    it("feeds each pipeline the output of the previous one", async () => {
      // Second pipeline reads what first pipeline wrote
      const appendPipeline: IEnrichmentPipeline = {
        name: "append",
        field: "chain",
        enrich: async (aco): Promise<EnrichmentResult> => ({
          aco: {
            frontmatter: {
              ...aco.frontmatter,
              chain: `${aco.frontmatter["chain"] ?? ""}>step2`,
            },
            body: aco.body,
          },
          fieldUpdated: "chain",
          confidence: 1,
          model: "stamp",
        }),
      };

      const initPipeline: IEnrichmentPipeline = {
        name: "init",
        field: "chain",
        enrich: async (aco): Promise<EnrichmentResult> => ({
          aco: {
            frontmatter: { ...aco.frontmatter, chain: "step1" },
            body: aco.body,
          },
          fieldUpdated: "chain",
          confidence: 1,
          model: "stamp",
        }),
      };

      const enricher = new BatchEnricher(NOOP_PROVIDER, [initPipeline, appendPipeline]);
      const result = await enricher.enrichOne(makeACO("x"));
      expect(result.frontmatter["chain"]).toBe("step1>step2");
    });
  });

  describe("enrichMany", () => {
    it("enriches multiple ACOs and preserves input order", async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [makeStampPipeline("done")]);
      const acos = [makeACO("a"), makeACO("b"), makeACO("c")];

      const { results, errors } = await enricher.enrichMany(acos);

      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(3);
      expect(results[0]!.frontmatter["id"]).toBe("a");
      expect(results[1]!.frontmatter["id"]).toBe("b");
      expect(results[2]!.frontmatter["id"]).toBe("c");
    });

    it("calls onProgress after each ACO with correct counts", async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [makeStampPipeline("done")]);
      const acos = [makeACO("a"), makeACO("b"), makeACO("c")];
      const progress: Array<[number, number]> = [];

      await enricher.enrichMany(acos, {
        onProgress: (completed, total) => progress.push([completed, total]),
      });

      expect(progress).toEqual([
        [1, 3],
        [2, 3],
        [3, 3],
      ]);
    });

    it("handles errors gracefully: failed ACO is captured, others succeed", async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [makeFailingPipeline()]);
      const acos = [makeACO("a"), makeACO("b")];

      const { results, errors } = await enricher.enrichMany(acos);

      // Both failed (the only pipeline always throws)
      expect(errors).toHaveLength(2);
      expect(results).toHaveLength(0);
      expect(errors[0]!.error).toMatch(/pipeline exploded/);
    });

    it("succeeds for healthy ACOs even when one ACO fails", async () => {
      // Mix: first pipeline is fine, second fails only for specific ACO
      let _callCount = 0;
      const selectiveFail: IEnrichmentPipeline = {
        name: "selective",
        field: "test",
        enrich: async (aco): Promise<EnrichmentResult> => {
          _callCount++;
          if (aco.frontmatter["id"] === "bad") throw new Error("bad aco");
          return {
            aco: { frontmatter: { ...aco.frontmatter, enriched: true }, body: aco.body },
            fieldUpdated: "test",
            confidence: 1,
            model: "stamp",
          };
        },
      };

      const enricher = new BatchEnricher(NOOP_PROVIDER, [selectiveFail]);
      const acos = [makeACO("good1"), makeACO("bad"), makeACO("good2")];

      const { results, errors } = await enricher.enrichMany(acos);

      expect(results).toHaveLength(2);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.id).toBe("bad");
      expect(errors[0]!.error).toMatch(/bad aco/);

      // Successful results maintain order
      expect(results[0]!.frontmatter["id"]).toBe("good1");
      expect(results[1]!.frontmatter["id"]).toBe("good2");
    });

    it("uses index-N as id when ACO has no id field", async () => {
      const enricher = new BatchEnricher(NOOP_PROVIDER, [makeFailingPipeline()]);
      const aco: ACO = { frontmatter: { title: "No ID" }, body: "body" };

      const { errors } = await enricher.enrichMany([aco]);

      expect(errors[0]!.id).toBe("index-0");
    });

    it("passes options through to pipelines", async () => {
      let receivedOptions: EnrichmentOptions | undefined;
      const capturePipeline: IEnrichmentPipeline = {
        name: "capture",
        field: "test",
        enrich: async (aco, _provider, options): Promise<EnrichmentResult> => {
          receivedOptions = options;
          return {
            aco,
            fieldUpdated: "test",
            confidence: 1,
            model: "stamp",
          };
        },
      };

      const enricher = new BatchEnricher(NOOP_PROVIDER, [capturePipeline]);
      await enricher.enrichMany([makeACO("x")], { force: true });

      expect(receivedOptions?.force).toBe(true);
    });
  });
});

describe("BatchEnricher — concurrency", () => {
  function makeSlowPipeline(delays: Record<string, number>, log: string[]): IEnrichmentPipeline {
    return {
      name: "slow",
      field: "done",
      enrich: async (aco): Promise<EnrichmentResult> => {
        const id = String(aco.frontmatter["id"]);
        log.push(`start:${id}`);
        await new Promise((r) => setTimeout(r, delays[id] ?? 0));
        log.push(`end:${id}`);
        return {
          aco: { ...aco, frontmatter: { ...aco.frontmatter, done: true } },
          fieldUpdated: "done",
          confidence: 1,
          model: "m",
        };
      },
    };
  }

  it("is strictly serial by default", async () => {
    const log: string[] = [];
    const enricher = new BatchEnricher(NOOP_PROVIDER, [makeSlowPipeline({ a: 10, b: 1 }, log)]);
    await enricher.enrichMany([makeACO("a"), makeACO("b")]);
    expect(log).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("runs up to `concurrency` ACOs at once and keeps input order in results", async () => {
    const log: string[] = [];
    const enricher = new BatchEnricher(NOOP_PROVIDER, [makeSlowPipeline({ a: 30, b: 1, c: 1 }, log)]);
    const { results } = await enricher.enrichMany([makeACO("a"), makeACO("b"), makeACO("c")], { concurrency: 2 });
    expect(log.slice(0, 2)).toEqual(["start:a", "start:b"]); // two in flight
    expect(results.map((r) => r.frontmatter["id"])).toEqual(["a", "b", "c"]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const gauge: IEnrichmentPipeline = {
      name: "gauge",
      field: "x",
      enrich: async (aco): Promise<EnrichmentResult> => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return { aco, fieldUpdated: "x", confidence: 1, model: "m" };
      },
    };
    await new BatchEnricher(NOOP_PROVIDER, [gauge]).enrichMany(
      Array.from({ length: 12 }, (_, i) => makeACO(`n${i}`)),
      { concurrency: 3 }
    );
    expect(peak).toBe(3);
  });

  it("reports the input index of failures and sorts them", async () => {
    const selective: IEnrichmentPipeline = {
      name: "s",
      field: "x",
      enrich: async (aco): Promise<EnrichmentResult> => {
        if (String(aco.frontmatter["id"]).startsWith("bad")) throw new Error("nope");
        return { aco, fieldUpdated: "x", confidence: 1, model: "m" };
      },
    };
    const { results, errors } = await new BatchEnricher(NOOP_PROVIDER, [selective]).enrichMany(
      [makeACO("ok0"), makeACO("bad1"), makeACO("ok2"), makeACO("bad3")],
      { concurrency: 4 }
    );
    expect(results.map((r) => r.frontmatter["id"])).toEqual(["ok0", "ok2"]);
    expect(errors.map((e) => [e.id, e.index])).toEqual([
      ["bad1", 1],
      ["bad3", 3],
    ]);
  });

  it("does not leak batch-only options into pipelines", async () => {
    let received: Record<string, unknown> | undefined;
    const capture: IEnrichmentPipeline = {
      name: "c",
      field: "x",
      enrich: async (aco, _p, options): Promise<EnrichmentResult> => {
        received = options as Record<string, unknown>;
        return { aco, fieldUpdated: "x", confidence: 1, model: "m" };
      },
    };
    await new BatchEnricher(NOOP_PROVIDER, [capture]).enrichMany([makeACO("a")], {
      concurrency: 2,
      force: true,
      onProgress: () => {},
    });
    expect(received).toEqual({ force: true });
  });
});
