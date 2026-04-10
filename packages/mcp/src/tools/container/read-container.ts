import { z } from "zod";
import type { IStorageAdapter } from "@acp/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the container to retrieve"),
});

const definition: ACPToolDefinition = {
  name: "read_container",
  description:
    "Retrieve a container by id. Returns frontmatter, body, and a computed rollup of total token counts from contained ACOs.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

export function createReadContainerTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id } = inputSchema.parse(input);
      const container = await storage.getContainer(id);

      if (!container) {
        return { success: false, error: `Container not found: ${id}` };
      }

      // Compute token rollup from contained ACOs
      const objectIds = container.frontmatter["objects"] as string[] | undefined;
      let rollup: { total_approximate: number; aco_count: number } | null = null;

      if (objectIds && objectIds.length > 0) {
        let totalApproximate = 0;
        let loadedCount = 0;

        for (const acoId of objectIds) {
          const aco = await storage.getACO(acoId);
          if (aco) {
            loadedCount++;
            const tokenCounts = aco.frontmatter["token_counts"] as
              | Record<string, number>
              | undefined;
            if (tokenCounts?.["approximate"]) {
              totalApproximate += tokenCounts["approximate"];
            }
          }
        }

        rollup = {
          total_approximate: totalApproximate,
          aco_count: loadedCount,
        };
      }

      return {
        success: true,
        data: {
          frontmatter: container.frontmatter,
          body: container.body,
          ...(rollup !== null && { rollup }),
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
