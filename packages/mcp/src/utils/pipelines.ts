import type { ACO, IStorageAdapter } from "@atomic-content-protocol/core";
import type { IEnrichmentPipeline, IEnrichmentProvider } from "@atomic-content-protocol/enrichment";
import {
  ClassificationPipeline,
  EmbedPipeline,
  EntityPipeline,
  hasValue,
  SummaryPipeline,
  TagPipeline,
  UnifiedPipeline,
} from "@atomic-content-protocol/enrichment";

export const PIPELINE_NAMES = ["tag", "summary", "entity", "classification", "unified", "embed"] as const;
export type PipelineName = (typeof PIPELINE_NAMES)[number];

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

function provenanceOf(aco: ACO): Record<string, unknown> {
  const p = aco.frontmatter["provenance"];
  return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
}

/**
 * Whether running `name` on `aco` would change anything. Mirrors the
 * pipelines' own idempotency rule (a non-empty value is never overwritten
 * without `force`) so callers can skip the LLM call — and the round trip to
 * storage — entirely.
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
      return ["tags", "summary", "classification", "key_entities", "language"].some((f) => !hasValue(fm[f]));
    case "embed":
      return !provenanceOf(aco)["embedding"];
  }
}

export interface RunPipelinesResult {
  aco: ACO;
  /** Pipelines that actually ran (after idempotency filtering). */
  ran: PipelineName[];
  /** True when an embedding was produced and persisted to storage. */
  embedded: boolean;
}

/**
 * Run pipelines over one ACO. Unlike `BatchEnricher.enrichOne`, this keeps
 * the per-pipeline results so an `EmbedPipeline` vector can be persisted via
 * `storage.putEmbedding` — the vector is never written to frontmatter.
 */
export async function runPipelines(
  aco: ACO,
  names: PipelineName[],
  provider: IEnrichmentProvider,
  storage: IStorageAdapter,
  options: { force: boolean; tool: string }
): Promise<RunPipelinesResult> {
  const ran = options.force ? names : names.filter((n) => needsPipeline(aco, n));
  let current = aco;
  let embedded = false;

  for (const name of ran) {
    const result = await buildPipeline(name).enrich(current, provider, { force: options.force, tool: options.tool });
    current = result.aco;
    if (result.embedding && typeof storage.putEmbedding === "function") {
      const id = String(current.frontmatter["id"] ?? "");
      if (id) {
        await storage.putEmbedding(id, result.embedding, result.model);
        embedded = true;
      }
    }
  }

  return { aco: current, ran, embedded };
}

/** Text used for embeddings and semantic comparison: title + body. */
export function embeddingText(aco: ACO): string {
  const title = String(aco.frontmatter["title"] ?? "");
  return [title, aco.body ?? ""].filter(Boolean).join("\n\n");
}
