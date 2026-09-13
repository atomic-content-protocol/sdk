import { validateACO } from "@atomic-content-protocol/core";
import { z } from "zod";
import type { ToolContext } from "../../context.js";
import { toErrorMessage } from "../../context.js";
import type { ACPToolDefinition, ToolEntry, ToolOutput } from "../../types/tool.js";

const inputSchema = z.object({});

const definition: ACPToolDefinition = {
  name: "validate_vault",
  description:
    "Validate all ACOs in the vault against the ACP schema. Returns a summary of valid/invalid counts and detailed validation errors for any invalid ACOs.",
  inputSchema,
  annotations: { readOnlyHint: true },
};

interface ValidationError {
  id: string;
  title: string | null;
  errors: Array<{ path: string; message: string }>;
}

export function createValidateVaultTool(ctx: ToolContext): ToolEntry {
  const handler = async (_input: unknown): Promise<ToolOutput> => {
    try {
      // Load all ACOs in batches to avoid memory issues with large vaults
      const PAGE_SIZE = 100;
      let offset = 0;
      let total = 0;
      let valid = 0;
      const invalid: ValidationError[] = [];

      while (true) {
        const page = await ctx.storage.listACOs({ limit: PAGE_SIZE, offset, sortBy: "created", order: "asc" });
        if (page.length === 0) break;

        for (const aco of page) {
          total++;
          const result = validateACO(aco.frontmatter);
          if (result.valid) {
            valid++;
          } else {
            invalid.push({
              id: String(aco.frontmatter["id"] ?? "unknown"),
              title: (aco.frontmatter["title"] as string | null) ?? null,
              errors: result.errors ?? [],
            });
          }
        }

        offset += page.length;
        if (page.length < PAGE_SIZE) break;
      }

      return {
        success: true,
        data: {
          total,
          valid,
          invalid: invalid.length,
          errors: invalid,
        },
      };
    } catch (err) {
      return { success: false, error: toErrorMessage(err) };
    }
  };

  return { definition, handler };
}
