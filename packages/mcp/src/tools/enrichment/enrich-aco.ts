import { z } from "zod";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";
import { PIPELINE_NAMES, type PipelineName, runPipelines } from "../../utils/pipelines.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the ACO to enrich"),
  pipelines: z
    .array(z.enum(PIPELINE_NAMES))
    .optional()
    .default(["unified"])
    .describe(
      "Enrichment pipelines to run. 'unified' fills tags+summary+entities+classification+language in one LLM call; 'embed' stores a vector for find_similar / detect_relationships (needs an embedding-capable provider)."
    ),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, regenerate fields even when they already have values. If false, fields with values are left untouched."
    ),
});

const definition: ACPToolDefinition = {
  name: "enrich_aco",
  description:
    "Run LLM enrichment pipelines on an ACO and write the result back to the vault. Existing non-empty fields are preserved unless force=true. Returns updated frontmatter and which pipelines ran.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
};

export function createEnrichACOTool(ctx: ToolContext): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, pipelines, force } = inputSchema.parse(input);

      const aco = await ctx.storage.getACO(id);
      if (!aco) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      const provider = ctx.getProvider();
      const {
        aco: enriched,
        ran,
        embedded,
        warning,
      } = await runPipelines(aco, pipelines as PipelineName[], provider, ctx.storage, {
        force,
        tool: ctx.toolId,
      });

      if (ran.length === 0) {
        return {
          success: true,
          data: {
            id,
            pipelines_run: [],
            embedded: false,
            ...(warning ? { warning } : {}),
            message: warning
              ? "Nothing ran."
              : "All requested enrichment already present. Use force=true to re-enrich.",
            frontmatter: aco.frontmatter,
          },
        };
      }

      await ctx.storage.putACO(enriched);
      return {
        success: true,
        data: { id, pipelines_run: ran, embedded, ...(warning ? { warning } : {}), frontmatter: enriched.frontmatter },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
