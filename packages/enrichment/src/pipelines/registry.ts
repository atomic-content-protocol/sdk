import type { ACO } from "@atomic-content-protocol/core";
import { ClassificationPipeline } from "./classification.pipeline.js";
import { EmbedPipeline } from "./embed.pipeline.js";
import { EntityPipeline } from "./entity.pipeline.js";
import type { IEnrichmentPipeline } from "./pipeline.interface.js";
import { hasValue, readProvenance } from "./single-field.pipeline.js";
import { SummaryPipeline } from "./summary.pipeline.js";
import { TagPipeline } from "./tag.pipeline.js";
import { UnifiedPipeline } from "./unified.pipeline.js";

/** Names accepted by CLIs and MCP tools for `--pipelines` / `pipelines`. */
export const PIPELINE_NAMES = ["tag", "summary", "entity", "classification", "unified", "embed"] as const;
export type PipelineName = (typeof PIPELINE_NAMES)[number];

export function isPipelineName(name: string): name is PipelineName {
  return (PIPELINE_NAMES as readonly string[]).includes(name);
}

export function buildPipeline(name: PipelineName): IEnrichmentPipeline {
  switch (name) {
    case "tag":
      return new TagPipeline();
    case "summary":
      return new SummaryPipeline();
    case "entity":
      return new EntityPipeline();
    case "classification":
      return new ClassificationPipeline();
    case "unified":
      return new UnifiedPipeline();
    case "embed":
      return new EmbedPipeline();
  }
}

/** Fields the unified pipeline fills. */
const UNIFIED_FIELDS = ["tags", "summary", "classification", "key_entities", "language"] as const;

/**
 * Whether running `name` on `aco` would change anything. Mirrors the
 * pipelines' own idempotency rule (a non-empty value is never overwritten
 * without `force`) so callers can skip the LLM call — and the round trip to
 * storage — entirely, and can budget only for work that will happen.
 */
export function needsPipeline(aco: ACO, name: PipelineName): boolean {
  const fm = aco.frontmatter;
  switch (name) {
    case "tag":
      return !hasValue(fm["tags"]);
    case "summary":
      return !hasValue(fm["summary"]);
    case "entity":
      return !hasValue(fm["key_entities"]);
    case "classification":
      return !hasValue(fm["classification"]);
    case "unified":
      return UNIFIED_FIELDS.some((f) => !hasValue(fm[f]));
    case "embed":
      return !readProvenance(fm)["embedding"];
  }
}

/** Pipelines from `names` that would actually do work on `aco`. */
export function pipelinesNeeded(aco: ACO, names: readonly PipelineName[], force = false): PipelineName[] {
  return force ? [...names] : names.filter((n) => needsPipeline(aco, n));
}
