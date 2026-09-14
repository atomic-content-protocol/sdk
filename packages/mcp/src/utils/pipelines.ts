import type { ACO, IStorageAdapter } from "@atomic-content-protocol/core";
import type { IEnrichmentProvider } from "@atomic-content-protocol/enrichment";
import {
  buildPipeline,
  needsPipeline,
  PIPELINE_NAMES,
  type PipelineName,
  pipelinesNeeded,
} from "@atomic-content-protocol/enrichment";

export { buildPipeline, needsPipeline, PIPELINE_NAMES, type PipelineName };

export interface RunPipelinesResult {
  aco: ACO;
  /** Pipelines that actually ran (after idempotency filtering). */
  ran: PipelineName[];
  /** True when an embedding was produced and persisted to storage. */
  embedded: boolean;
  /** Set when `embed` was requested but the storage adapter cannot persist vectors. */
  warning?: string;
}

/**
 * Run pipelines over one ACO. Unlike `BatchEnricher.enrichOne`, this keeps
 * the per-pipeline results so an `EmbedPipeline` vector can be persisted via
 * `storage.putEmbedding` — the vector is never written to frontmatter.
 *
 * If the adapter has no `putEmbedding`, the `embed` pipeline is skipped
 * entirely (rather than run and lost), so its provenance marker is never
 * written and a later run against a capable adapter still embeds.
 */
export async function runPipelines(
  aco: ACO,
  names: PipelineName[],
  provider: IEnrichmentProvider,
  storage: IStorageAdapter,
  options: { force: boolean; tool: string }
): Promise<RunPipelinesResult> {
  const canEmbed = typeof storage.putEmbedding === "function";
  let warning: string | undefined;
  let wanted = pipelinesNeeded(aco, names, options.force);
  if (!canEmbed && wanted.includes("embed")) {
    wanted = wanted.filter((n) => n !== "embed");
    warning = "embed skipped: the storage adapter does not implement putEmbedding";
  }

  let current = aco;
  let embedded = false;
  const ran: PipelineName[] = [];

  for (const name of wanted) {
    const result = await buildPipeline(name).enrich(current, provider, { force: options.force, tool: options.tool });
    if (result.model === "skipped") continue;
    ran.push(name);
    current = result.aco;
    if (result.embedding && storage.putEmbedding) {
      const id = String(current.frontmatter["id"] ?? "");
      if (id) {
        await storage.putEmbedding(id, result.embedding, result.model);
        embedded = true;
      }
    }
  }

  return { aco: current, ran, embedded, ...(warning ? { warning } : {}) };
}

/** Text used for embeddings and semantic comparison: title + body. */
export function embeddingText(aco: ACO): string {
  const title = String(aco.frontmatter["title"] ?? "");
  return [title, aco.body ?? ""].filter(Boolean).join("\n\n");
}
