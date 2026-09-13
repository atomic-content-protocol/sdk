import type { ACO } from "@atomic-content-protocol/core";
import type { EnrichmentOptions, IEnrichmentPipeline } from "../pipelines/pipeline.interface.js";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";

export interface BatchOptions extends EnrichmentOptions {
  /**
   * Maximum number of ACOs enriched at the same time. Default 1 (strictly
   * serial, the safest choice for LLM rate limits). Raise it when your
   * provider quota allows; the router's circuit breakers still apply.
   */
  concurrency?: number;
  /** Called after each ACO completes (or fails), with running totals. */
  onProgress?: (completed: number, total: number) => void;
}

export interface BatchResult {
  /** Successfully enriched ACOs, in the same relative order as the input. */
  results: ACO[];
  /** ACOs that failed, with their id (or `index-N`) and error message. */
  errors: Array<{ id: string; index: number; error: string }>;
}

/**
 * BatchEnricher — runs a sequence of enrichment pipelines over one or many ACOs.
 *
 * The router is accepted as `IEnrichmentProvider` — `ProviderRouter` satisfies
 * this interface, so fallback and circuit-breaking are handled transparently.
 */
export class BatchEnricher {
  constructor(
    private readonly provider: IEnrichmentProvider,
    private readonly pipelines: IEnrichmentPipeline[]
  ) {}

  /**
   * Run all pipelines on a single ACO in sequence.
   * Each pipeline receives the output of the previous one.
   */
  async enrichOne(aco: ACO, options?: EnrichmentOptions): Promise<ACO> {
    let current = aco;
    for (const pipeline of this.pipelines) {
      const result = await pipeline.enrich(current, this.provider, options);
      current = result.aco;
    }
    return current;
  }

  /**
   * Run all pipelines on each ACO in the array.
   *
   * ACOs are processed with at most `options.concurrency` in flight (default
   * 1). Output order is stable regardless of completion order: `results`
   * holds the successful ACOs in input order and `errors` carries the input
   * index of each failure so callers can zip back to their inputs.
   */
  async enrichMany(acos: ACO[], options?: BatchOptions): Promise<BatchResult> {
    const total = acos.length;
    const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 1));
    const slots: Array<ACO | undefined> = new Array(total);
    const errors: BatchResult["errors"] = [];
    let completed = 0;
    let next = 0;

    const { concurrency: _c, onProgress, ...pipelineOptions } = options ?? {};

    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= total) return;
        const aco = acos[i] as ACO;
        const id = String(aco.frontmatter["id"] ?? `index-${i}`);
        try {
          slots[i] = await this.enrichOne(aco, pipelineOptions);
        } catch (err) {
          errors.push({ id, index: i, error: err instanceof Error ? err.message : String(err) });
        }
        completed += 1;
        onProgress?.(completed, total);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));

    errors.sort((a, b) => a.index - b.index);
    return { results: slots.filter((s): s is ACO => s !== undefined), errors };
  }
}
