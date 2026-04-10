import type { ACO } from "@acp/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type {
  IEnrichmentPipeline,
  EnrichmentResult,
  EnrichmentOptions,
} from "./pipeline.interface.js";
import { buildEntityPrompt } from "../utils/prompts.js";
import { createProvenanceRecord } from "../utils/provenance.js";

export interface KeyEntity {
  type:
    | "person"
    | "organization"
    | "technology"
    | "concept"
    | "location"
    | "event";
  name: string;
  confidence: number;
}

/**
 * EntityPipeline — extracts named entities from ACO content.
 *
 * Idempotent: skips enrichment if `frontmatter.key_entities` and a provenance
 * record for "key_entities" already exist, unless `options.force` is true.
 */
export class EntityPipeline implements IEnrichmentPipeline {
  readonly name = "entity";
  readonly field = "key_entities";

  async enrich(
    aco: ACO,
    provider: IEnrichmentProvider,
    options?: EnrichmentOptions
  ): Promise<EnrichmentResult> {
    const { frontmatter, body } = aco;

    // Idempotency check
    const existing = frontmatter["key_entities"];
    const existingProvenance = (
      frontmatter["provenance"] as Record<string, unknown> | undefined
    )?.["key_entities"];
    if (existing && existingProvenance && !options?.force) {
      return {
        aco,
        fieldUpdated: this.field,
        confidence: 0,
        model: "skipped",
      };
    }

    const title = String(frontmatter["title"] ?? "");
    const prompt = buildEntityPrompt(title, body);

    const response = await provider.complete(prompt, {
      maxTokens: 500,
      temperature: 0.3,
    });

    // Parse JSON array from response
    let entities: KeyEntity[] = [];
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        const parsed: unknown = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          entities = parsed.filter(
            (item): item is KeyEntity =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              "name" in item &&
              "confidence" in item
          );
        }
      } catch {
        // Fall through — entities remains []
      }
    }

    const confidence = entities.length > 0 ? 0.8 : 0.0;
    const provRecord = createProvenanceRecord(provider.model, confidence);

    const updatedFrontmatter: Record<string, unknown> = {
      ...frontmatter,
      key_entities: entities,
      provenance: {
        ...(frontmatter["provenance"] as Record<string, unknown> | undefined),
        key_entities: provRecord,
      },
    };

    return {
      aco: { frontmatter: updatedFrontmatter, body },
      fieldUpdated: this.field,
      confidence,
      model: provider.model,
    };
  }
}
