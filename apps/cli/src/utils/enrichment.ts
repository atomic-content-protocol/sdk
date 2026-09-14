import type { ACO } from "@atomic-content-protocol/core";
import type {
  IEnrichmentPipeline,
  PipelineName,
  ProviderConfig,
  QualityTier,
} from "@atomic-content-protocol/enrichment";
import {
  buildPipeline,
  DEFAULT_QUALITY,
  estimateEnrichmentCost,
  isPipelineName,
  MODEL_PRESETS,
  PIPELINE_NAMES,
  ProviderRouter,
  pipelinesNeeded,
} from "@atomic-content-protocol/enrichment";
import type { ACPConfig } from "./config.js";
import { CliError, EXIT } from "./errors.js";

export { PIPELINE_NAMES, type PipelineName };

/** Parse `--pipelines a,b,c`, rejecting unknown names with a usage error. */
export function parsePipelines(raw: string): PipelineName[] {
  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) throw new CliError("No pipelines given", EXIT.USAGE);
  const bad = names.filter((n) => !isPipelineName(n));
  if (bad.length > 0) {
    throw new CliError(
      `Unknown pipeline(s): ${bad.join(", ")}`,
      EXIT.USAGE,
      `Valid options: ${PIPELINE_NAMES.join(", ")}`
    );
  }
  return [...new Set(names)] as PipelineName[];
}

export function buildPipelines(names: PipelineName[]): IEnrichmentPipeline[] {
  return names.map(buildPipeline);
}

/** Resolve the ProviderConfig from config file + environment. */
export function resolveProviderConfig(config: ACPConfig, env: NodeJS.ProcessEnv = process.env): ProviderConfig | null {
  const e = config.enrichment;
  const providers: ProviderConfig = {};
  const quality = e?.quality ?? (env["ACP_QUALITY"] as QualityTier | undefined);
  if (quality) providers.quality = quality;

  const anthropicKey = e?.anthropic?.api_key || env["ANTHROPIC_API_KEY"];
  if (anthropicKey) providers.anthropic = { apiKey: anthropicKey, model: e?.anthropic?.model };

  const openaiKey = e?.openai?.api_key || env["OPENAI_API_KEY"];
  if (openaiKey)
    providers.openai = { apiKey: openaiKey, model: e?.openai?.model, embeddingModel: e?.openai?.embedding_model };

  if (e?.ollama) {
    providers.ollama = { baseUrl: e.ollama.base_url, model: e.ollama.model, embeddingModel: e.ollama.embedding_model };
  }

  return providers.anthropic || providers.openai || providers.ollama ? providers : null;
}

/** Build the router, or throw a CliError explaining how to configure a provider. */
export function createRouter(config: ACPConfig): ProviderRouter {
  const providers = resolveProviderConfig(config);
  if (!providers) {
    throw new CliError(
      "No enrichment providers configured.",
      EXIT.NO_PROVIDER,
      "Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or add an `enrichment` section to .acp/config.json."
    );
  }
  return ProviderRouter.fromConfig(providers);
}

/** Headline model for cost estimates, matching what the router will use. */
export function estimateModel(config: ACPConfig): string {
  const e = config.enrichment;
  const tier = e?.quality ?? DEFAULT_QUALITY;
  return (
    e?.anthropic?.model ??
    (e?.anthropic || process.env["ANTHROPIC_API_KEY"]
      ? MODEL_PRESETS[tier].anthropic
      : (e?.openai?.model ?? MODEL_PRESETS[tier].openai))
  );
}

export interface BatchPlan {
  /** ACOs that fit within the cap, in input order. */
  selected: ACO[];
  /** ACOs left out because the cumulative estimate would exceed the cap. */
  deferred: ACO[];
  /** ACOs that need none of the requested pipelines (already enriched). */
  skipped: ACO[];
  perACOCost: number[];
  totalCost: number;
}

/**
 * Decide up front which ACOs can be enriched within `maxCost` (USD), using
 * per-ACO estimates. Nothing is spent on a deferred ACO — the check happens
 * before any provider call, not after.
 */
export function planBatch(
  acos: ACO[],
  model: string,
  maxCost?: number,
  pipelines: readonly PipelineName[] = ["unified"],
  force = false
): BatchPlan {
  const selected: ACO[] = [];
  const deferred: ACO[] = [];
  const skipped: ACO[] = [];
  const perACOCost: number[] = [];
  let total = 0;
  for (const aco of acos) {
    if (pipelinesNeeded(aco, pipelines, force).length === 0) {
      skipped.push(aco);
      continue;
    }
    const cost = estimateEnrichmentCost(aco.body, "standard", { model }).cost;
    if (maxCost !== undefined && total + cost > maxCost) {
      deferred.push(aco);
      continue;
    }
    selected.push(aco);
    perACOCost.push(cost);
    total += cost;
  }
  return { selected, deferred, skipped, perACOCost, totalCost: total };
}
