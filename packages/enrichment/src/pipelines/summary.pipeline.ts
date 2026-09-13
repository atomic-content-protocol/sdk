import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type { EnrichmentOptions } from "./pipeline.interface.js";
import { SingleFieldPipeline, type GeneratedField } from "./single-field.pipeline.js";
import { buildSummaryPrompt } from "../utils/prompts.js";
import { completeWithModel } from "../utils/provider-meta.js";

/** Spec limit for `summary` (ACP §3). */
const MAX_SUMMARY_CHARS = 500;

/**
 * SummaryPipeline — generates a 2-sentence summary of ACO content.
 *
 * Idempotent: leaves an existing non-empty `summary` alone unless `force` is set.
 */
export class SummaryPipeline extends SingleFieldPipeline<string> {
  readonly name = "summary";
  readonly field = "summary";

  protected async generate(
    aco: ACO,
    provider: IEnrichmentProvider,
    _options?: EnrichmentOptions
  ): Promise<GeneratedField<string> | null> {
    const title = String(aco.frontmatter["title"] ?? "");
    const { result, model } = await completeWithModel(provider, buildSummaryPrompt(title, aco.body), {
      maxTokens: 256,
      temperature: 0.3,
    });

    const summary = result.trim().replace(/\s+/g, " ").slice(0, MAX_SUMMARY_CHARS);
    if (!summary) return null;

    return { value: summary, confidence: 0.85, model };
  }
}
