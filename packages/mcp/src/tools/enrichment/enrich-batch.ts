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
import type { IStorageAdapter, ACO } from "@atomic-content-protocol/core";
import type { ProviderConfig } from "@atomic-content-protocol/enrichment";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const PIPELINE_NAMES = ["tag", "summary", "entity", "classification", "unified"] as const;
type PipelineName = (typeof PIPELINE_NAMES)[number];

const inputSchema = z.object({
  ids: z
    .array(z.string())
    .optional()
    .describe("Array of ACO ids to enrich. Mutually exclusive with container_id."),
  container_id: z
    .string()
    .optional()
    .describe(
      "Enrich all ACOs in this container. Mutually exclusive with ids."
    ),
  pipelines: z
    .array(z.enum(PIPELINE_NAMES))
    .optional()
    .default(["unified"])
    .describe("Enrichment pipelines to run on each ACO"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Re-enrich even if enrichment data already exists"),
});

const definition: ACPToolDefinition = {
  name: "enrich_batch",
  description:
    "Run enrichment pipelines on multiple ACOs at once. Provide either ids (explicit list) or container_id (all ACOs in a container). Returns a summary of enriched/failed counts.",
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

export function createEnrichBatchTool(
  storage: IStorageAdapter,
  enrichmentConfig: { providers: ProviderConfig }
): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { ids, container_id, pipelines, force } = inputSchema.parse(input);

      if (!ids && !container_id) {
        return {
          success: false,
          error: "Provide either ids or container_id",
        };
      }
      if (ids && container_id) {
        return {
          success: false,
          error: "Provide either ids or container_id, not both",
        };
      }

      // Resolve the list of ACOs to enrich
      let acos: ACO[] = [];

      if (ids) {
        const results = await Promise.all(ids.map((id) => storage.getACO(id)));
        acos = results.filter((a): a is ACO => a !== null);
      } else if (container_id) {
        const container = await storage.getContainer(container_id);
        if (!container) {
          return { success: false, error: `Container not found: ${container_id}` };
        }
        const objectIds = container.frontmatter["objects"] as string[] | undefined;
        if (!objectIds || objectIds.length === 0) {
          return { success: true, data: { enriched: 0, failed: 0, errors: [] } };
        }
        const results = await Promise.all(objectIds.map((id) => storage.getACO(id)));
        acos = results.filter((a): a is ACO => a !== null);
      }

      if (acos.length === 0) {
        return { success: true, data: { enriched: 0, failed: 0, errors: [] } };
      }

      // Optionally filter out already-enriched ACOs
      if (!force) {
        acos = acos.filter((aco) => {
          const pipelineNames = pipelines as PipelineName[];
          return pipelineNames.some((p) => {
            if (p === "tag") return !Array.isArray(aco.frontmatter["tags"]) || (aco.frontmatter["tags"] as unknown[]).length === 0;
            if (p === "summary") return !aco.frontmatter["summary"];
            if (p === "entity") return !Array.isArray(aco.frontmatter["key_entities"]) || (aco.frontmatter["key_entities"] as unknown[]).length === 0;
            if (p === "classification") return !aco.frontmatter["classification"];
            if (p === "unified") {
              const provenance = aco.frontmatter["provenance"] as Record<string, unknown> | undefined;
              return !provenance?.["unified"];
            }
            return true;
          });
        });
      }

      const router = ProviderRouter.fromConfig(enrichmentConfig.providers);
      const enricher = new BatchEnricher(router, buildPipelines(pipelines as PipelineName[]));

      // ACP §3.13 — identifies the software running enrichment.
      // Keep in sync with package.json version.
      const { results: enrichedACOs, errors } = await enricher.enrichMany(acos, {
        tool: "@atomic-content-protocol/mcp@0.1.0",
      });

      // Write enriched ACOs back to storage
      await Promise.all(enrichedACOs.map((aco) => storage.putACO(aco)));

      return {
        success: true,
        data: {
          enriched: enrichedACOs.length,
          failed: errors.length,
          errors,
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
