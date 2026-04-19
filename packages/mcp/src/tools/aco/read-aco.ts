import { z } from "zod";
import type { IStorageAdapter } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  id: z.string().min(1).describe("UUID of the ACO to retrieve"),
});

const definition: ACPToolDefinition = {
  name: "read_aco",
  description:
    "Retrieve a single Atomic Content Object by its id. Returns frontmatter and body.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

export function createReadACOTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id } = inputSchema.parse(input);
      const aco = await storage.getACO(id);

      if (!aco) {
        return { success: false, error: `ACO not found: ${id}` };
      }

      return {
        success: true,
        data: {
          frontmatter: aco.frontmatter,
          body: aco.body,
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
