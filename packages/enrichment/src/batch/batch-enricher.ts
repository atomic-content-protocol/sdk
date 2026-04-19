import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentPipeline, EnrichmentOptions } from "../pipelines/pipeline.interface.js";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";

/**
 * BatchEnricher — runs a sequence of enrichment pipelines over one or many ACOs.
 *
 * The router is accepted as `IEnrichmentProvider` — `ProviderRouter` satisfies
 * this interface, so fallback and circuit-breaking are handled transparently.
 *
 * ACOs in `enrichMany` are processed in **series** (not parallel) to respect
 * LLM rate limits.
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
   * Run all pipelines on each ACO in the array, one ACO at a time.
   *
   * Returns:
   *   - `results`  — successfully enriched ACOs (same order as input).
   *   - `errors`   — ACOs that failed, with their id and error message.
   *
   * `onProgress` is called after each ACO completes (or fails).
   */
  async enrichMany(
    acos: ACO[],
    options?: EnrichmentOptions & {
      onProgress?: (completed: number, total: number) => void;
    }
  ): Promise<{ results: ACO[]; errors: Array<{ id: string; error: string }> }> {
    const results: ACO[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (let i = 0; i < acos.length; i++) {
      const aco = acos[i]!;
      const id = String(aco.frontmatter["id"] ?? `index-${i}`);

      try {
        const enriched = await this.enrichOne(aco, options);
        results.push(enriched);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ id, error: message });
      }

      options?.onProgress?.(i + 1, acos.length);
    }

    return { results, errors };
  }
}
