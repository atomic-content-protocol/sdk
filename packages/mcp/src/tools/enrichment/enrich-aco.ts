import { z } from "zod";
import {
  BatchEnricher,
  TagPipeline,
  SummaryPipeline,
  EntityPipeline,
  ClassificationPipeline,
  UnifiedPipeline,
  ProviderRouter,
} from "@atomic-content-protocol/enrichment";
import type { IStorageAdapter } from "@atomic-content-protocol/core";
import type { ProviderConfig } from "@atomic-content-protocol/enrichment";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const PIPELINE_NAMES = ["tag", "summary", "entity", "classification", "unified"] as const;
type PipelineName = (typeof PIPELINE_NAMES)[number];

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the ACO to enrich"),
  pipelines: z
    .array(z.enum(PIPELINE_NAMES))
    .optional()
    .default(["unified"])
    .describe(
      "Enrichment pipelines to run. 'unified' runs tag+summary+entity+classification in one LLM call."
    ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, re-enrich even if enrichment data already exists. If false, skip pipelines that have already run."
    ),
});

const definition: ACPToolDefinition = {
  name: "enrich_aco",
  description:
    "Run LLM enrichment pipelines on an ACO. Writes enriched data (tags, summary, entities, classification) back to the vault. Returns updated frontmatter.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
};

function buildPipelines(names: PipelineName[]) {
  return names.map((name) => {
    switch (name) {
      case "tag": return new TagPipeline();
      case "summary": return new SummaryPipeline();
      case "entity": return new EntityPipeline();
      case "classification": return new ClassificationPipeline();
      case "unified": return new UnifiedPipeline();
    }
  });
}

export function createEnrichACOTool(
  storage: IStorageAdapter,
  enrichmentConfig: { providers: ProviderConfig }
): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, pipelines, force } = inputSchema.parse(input);

      const aco = await storage.getACO(id);
      if (!aco) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      // If not forced, skip pipelines that already ran
      let pipelinesToRun = pipelines as PipelineName[];
      if (!force) {
        pipelinesToRun = pipelinesToRun.filter((p) => {
          const provenance = aco.frontmatter["provenance"] as
            | Record<string, unknown>
            | undefined;
          if (!provenance) return true;
          // If the pipeline's output field already exists, skip it
          if (p === "tag" && Array.isArray(aco.frontmatter["tags"]) && (aco.frontmatter["tags"] as unknown[]).length > 0) return false;
          if (p === "summary" && aco.frontmatter["summary"]) return false;
          if (p === "entity" && Array.isArray(aco.frontmatter["key_entities"]) && (aco.frontmatter["key_entities"] as unknown[]).length > 0) return false;
          if (p === "classification" && aco.frontmatter["classification"]) return false;
          if (p === "unified" && provenance["unified"]) return false;
          return true;
        });
      }

      if (pipelinesToRun.length === 0) {
        return {
          success: true,
          data: {
            id,
            message: "All requested enrichment already present. Use force=true to re-enrich.",
            frontmatter: aco.frontmatter,
          },
        };
      }

      const router = ProviderRouter.fromConfig(enrichmentConfig.providers);
      const enricher = new BatchEnricher(router, buildPipelines(pipelinesToRun));
      const enriched = await enricher.enrichOne(aco);
      await storage.putACO(enriched);

      return {
        success: true,
        data: {
          id,
          pipelines_run: pipelinesToRun,
          frontmatter: enriched.frontmatter,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return { definition, handler };
}
