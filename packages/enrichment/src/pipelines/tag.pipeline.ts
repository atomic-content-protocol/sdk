import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type { EnrichmentOptions } from "./pipeline.interface.js";
import { SingleFieldPipeline, extractJsonArray, type GeneratedField } from "./single-field.pipeline.js";
import { buildTagPrompt } from "../utils/prompts.js";
import { completeWithModel } from "../utils/provider-meta.js";

const MAX_TAGS = 7;

/**
 * TagPipeline — extracts 3-7 tags/keywords from ACO content.
 *
 * Idempotent: leaves existing non-empty `tags` alone unless `force` is set.
 */
export class TagPipeline extends SingleFieldPipeline<string[]> {
  readonly name = "tag";
  readonly field = "tags";

  protected async generate(
    aco: ACO,
    provider: IEnrichmentProvider,
    _options?: EnrichmentOptions
  ): Promise<GeneratedField<string[]> | null> {
    const title = String(aco.frontmatter["title"] ?? "");
    const { result, model } = await completeWithModel(provider, buildTagPrompt(title, aco.body), {
      maxTokens: 150,
      temperature: 0.5,
    });

    const parsed = extractJsonArray(result);
    if (!parsed) return null;

    const seen = new Set<string>();
    const tags: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const tag = item.trim().toLowerCase().replace(/\s+/g, "-");
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
      if (tags.length >= MAX_TAGS) break;
    }
    if (tags.length === 0) return null;

    return { value: tags, confidence: 0.85, model };
  }
}
