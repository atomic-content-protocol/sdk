import type { ACO } from "@atomic-content-protocol/core";
import { z } from "zod";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import { needsPipeline, PIPELINE_NAMES, type PipelineName, runPipelines } from "../../utils/pipelines.js";
import { loadACOs } from "../../utils/storage.js";

const inputSchema = z
  .object({
    ids: z
      .array(z.string())
      .max(200)
      .optional()
      .describe("Array of ACO ids to enrich. Mutually exclusive with container_id."),
    container_id: z.string().optional().describe("Enrich all ACOs in this container. Mutually exclusive with ids."),
    pipelines: z
      .array(z.enum(PIPELINE_NAMES))
      .optional()
      .default(["unified"])
      .describe("Enrichment pipelines to run on each ACO"),
    force: z.boolean().optional().default(false).describe("Regenerate fields even when they already have values"),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .default(1)
      .describe("How many ACOs to enrich at the same time (default 1)"),
  })
  .refine((d) => Boolean(d.ids) !== Boolean(d.container_id), {
    message: "Provide either ids or container_id, not both",
  });

const definition: ACPToolDefinition = {
  name: "enrich_batch",
  description:
    "Run enrichment pipelines on multiple ACOs at once. Provide either ids (explicit list) or container_id (all ACOs in a container). ACOs whose requested fields are already filled are skipped unless force=true. Returns enriched/skipped/failed counts.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
};

export function createEnrichBatchTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { ids, container_id, pipelines, force, concurrency } = inputSchema.parse(input);
      const names = pipelines as PipelineName[];

      let acos: ACO[] = [];
      let missing: string[] = [];
      if (ids) {
        acos = await loadACOs(ctx.storage, ids);
        const found = new Set(acos.map((a) => String(a.frontmatter["id"])));
        missing = ids.filter((id) => !found.has(id));
      } else if (container_id) {
        const container = await ctx.storage.getContainer(container_id);
        if (!container) {
          return { success: false, error: `Container not found: ${container_id}` };
        }
        const objectIds = (container.frontmatter["objects"] as string[] | undefined) ?? [];
        acos = await loadACOs(ctx.storage, objectIds);
      }

      const todo = force ? acos : acos.filter((aco) => names.some((n) => needsPipeline(aco, n)));
      const skipped = acos.length - todo.length;

      if (todo.length === 0) {
        return { success: true, data: { enriched: 0, skipped, failed: 0, missing, errors: [] } };
      }

      const provider = ctx.getProvider();
      const errors: Array<{ id: string; error: string }> = [];
      let enriched = 0;
      let embedded = 0;
      let next = 0;

      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++;
          if (i >= todo.length) return;
          const aco = todo[i] as ACO;
          const id = String(aco.frontmatter["id"] ?? `index-${i}`);
          try {
            const result = await runPipelines(aco, names, provider, ctx.storage, { force, tool: ctx.toolId });
            if (result.ran.length > 0) {
              await ctx.storage.putACO(result.aco);
              enriched++;
              if (result.embedded) embedded++;
            }
          } catch (err) {
            errors.push({ id, error: toErrorMessage(err) });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

      return {
        success: true,
        data: { enriched, skipped, failed: errors.length, embedded, missing, errors },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
