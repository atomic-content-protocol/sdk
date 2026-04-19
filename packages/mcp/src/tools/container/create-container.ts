import { z } from "zod";
import { generateId } from "@atomic-content-protocol/core";
import type { IStorageAdapter } from "@atomic-content-protocol/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({
  title: z.string().min(1).describe("Title of the container"),
  objects: z
    .array(z.string())
    .optional()
    .describe("Array of ACO ids to include in the container"),
  summary: z.string().optional().describe("Summary description of the container"),
  tags: z.array(z.string()).optional().describe("Tags to apply to the container"),
  visibility: z
    .enum(["public", "private", "restricted"])
    .optional()
    .describe("Discovery visibility"),
  author_id: z
    .string()
    .min(1)
    .describe("Unique identifier for the author"),
  author_name: z
    .string()
    .min(1)
    .describe("Human-readable display name for the author"),
});

const definition: ACPToolDefinition = {
  name: "create_container",
  description:
    "Create a new Container — an ACO that groups other ACOs. Returns the container frontmatter including its generated id.",
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
};

export function createCreateContainerTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const validated = inputSchema.parse(input);
      const now = new Date().toISOString();
      const id = generateId();

      const frontmatter: Record<string, unknown> = {
        id,
        acp_version: "0.2",
        object_type: "container",
        source_type: "manual",
        created: now,
        author: { id: validated.author_id, name: validated.author_name },
        title: validated.title,
      };

      if (validated.objects) frontmatter["objects"] = validated.objects;
      if (validated.summary) frontmatter["summary"] = validated.summary;
      if (validated.tags) frontmatter["tags"] = validated.tags;
      if (validated.visibility) frontmatter["visibility"] = validated.visibility;

      const container = { frontmatter, body: "" };
      await storage.putContainer(container);

      return { success: true, data: frontmatter };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return { definition, handler };
}
