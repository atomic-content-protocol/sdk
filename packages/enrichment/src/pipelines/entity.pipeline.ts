import type { ACO } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type { EnrichmentOptions } from "./pipeline.interface.js";
import { SingleFieldPipeline, extractJsonArray, type GeneratedField } from "./single-field.pipeline.js";
import { buildEntityPrompt } from "../utils/prompts.js";
import { completeWithModel } from "../utils/provider-meta.js";

export const ENTITY_TYPES = ["person", "organization", "technology", "concept", "location", "event"] as const;

export interface KeyEntity {
  type: (typeof ENTITY_TYPES)[number];
  name: string;
  confidence: number;
}

const MAX_ENTITIES = 50;

function toKeyEntity(item: unknown): KeyEntity | null {
  if (typeof item !== "object" || item === null) return null;
  const obj = item as Record<string, unknown>;
  const name = typeof obj["name"] === "string" ? obj["name"].trim().slice(0, 200) : "";
  if (!name) return null;
  const rawType = typeof obj["type"] === "string" ? obj["type"].trim().toLowerCase() : "";
  const type = (ENTITY_TYPES as readonly string[]).includes(rawType)
    ? (rawType as KeyEntity["type"])
    : "concept";
  const rawConf = typeof obj["confidence"] === "number" && Number.isFinite(obj["confidence"]) ? obj["confidence"] : 0.5;
  return { type, name, confidence: Math.min(1, Math.max(0, rawConf)) };
}

/**
 * EntityPipeline — extracts named entities from ACO content.
 *
 * Idempotent: leaves existing non-empty `key_entities` alone unless `force` is set.
 */
export class EntityPipeline extends SingleFieldPipeline<KeyEntity[]> {
  readonly name = "entity";
  readonly field = "key_entities";

  protected async generate(
    aco: ACO,
    provider: IEnrichmentProvider,
    _options?: EnrichmentOptions
  ): Promise<GeneratedField<KeyEntity[]> | null> {
    const title = String(aco.frontmatter["title"] ?? "");
    const { result, model } = await completeWithModel(provider, buildEntityPrompt(title, aco.body), {
      maxTokens: 500,
      temperature: 0.3,
    });

    const parsed = extractJsonArray(result);
    if (!parsed) return null;

    const entities = parsed
      .map(toKeyEntity)
      .filter((e): e is KeyEntity => e !== null)
      .slice(0, MAX_ENTITIES);
    if (entities.length === 0) return null;

    return { value: entities, confidence: 0.8, model };
  }
}
