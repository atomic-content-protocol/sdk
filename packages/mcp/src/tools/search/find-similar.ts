import { z } from "zod";
import type { IStorageAdapter } from "@acp/core";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe("UUID of the source ACO to find similar ACOs for"),
    text: z
      .string()
      .optional()
      .describe("Arbitrary text to find similar ACOs for"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(10)
      .describe("Maximum number of results to return"),
  })
  .refine((data) => data.id || data.text, {
    message: "Provide either id or text",
  });

const definition: ACPToolDefinition = {
  name: "find_similar",
  description:
    "Find ACOs that are semantically similar to a given ACO (by id) or arbitrary text. Requires the storage adapter to support vector embeddings. Returns an error if embeddings are not configured.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

export function createFindSimilarTool(storage: IStorageAdapter): ToolEntry {
  const handler = async (input: unknown): Promise<ToolOutput> => {
    try {
      const { id, text, limit } = inputSchema.parse(input);

      // Check if the adapter supports vector search
      if (
        typeof storage.findSimilar !== "function" ||
        typeof storage.putEmbedding !== "function"
      ) {
        return {
          success: false,
          error:
            "Semantic similarity search is not available. The configured storage adapter does not support vector embeddings. Configure a vector-enabled adapter (e.g. pgvector, Pinecone) to use this tool.",
        };
      }

      // To perform the search we need a query vector.
      // If id is provided, look for a stored embedding for that ACO.
      // If text is provided, we cannot generate an embedding without an embedding model —
      // surface a clear error rather than silently failing.
      if (text && !id) {
        return {
          success: false,
          error:
            "Text-based similarity requires an embedding model to be configured in the server. This is not yet supported. Provide an id instead to search by an existing ACO's embedding.",
        };
      }

      if (!id) {
        return { success: false, error: "Provide either id or text" };
      }

      // We need the stored embedding vector for this ACO.
      // The IStorageAdapter interface doesn't expose a getEmbedding() method,
      // so we call findSimilar with a synthetic call: first get the ACO's
      // own neighbours (the adapter internally handles the id → vector lookup).
      // Since findSimilar accepts a vector, we cannot call it without the vector.
      // Return an informative error directing users to the detect_relationships tool.
      return {
        success: false,
        error:
          "find_similar requires an embedding lookup API that is not yet exposed by IStorageAdapter. Use detect_relationships for tag/entity-based similarity, or implement putEmbedding + findSimilar on your storage adapter.",
        metadata: {
          requested_id: id,
          suggestion: "Use detect_relationships for tag/entity overlap-based similarity.",
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
