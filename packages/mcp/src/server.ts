import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { IStorageAdapter } from "@acp/core";
import type { ProviderConfig } from "@acp/enrichment";

import {
  registerTool,
  getAllTools,
  getToolHandler,
  toolExists,
  clearRegistry,
} from "./tool-registry.js";
import { adaptToolForMCP } from "./tool-adapter.js";

// Tool factories
import { createCreateACOTool } from "./tools/aco/create-aco.js";
import { createReadACOTool } from "./tools/aco/read-aco.js";
import { createUpdateACOTool } from "./tools/aco/update-aco.js";
import { createDeleteACOTool } from "./tools/aco/delete-aco.js";
import { createListACOsTool } from "./tools/aco/list-acos.js";
import { createCreateContainerTool } from "./tools/container/create-container.js";
import { createReadContainerTool } from "./tools/container/read-container.js";
import { createListContainersTool } from "./tools/container/list-containers.js";
import { createEnrichACOTool } from "./tools/enrichment/enrich-aco.js";
import { createEnrichBatchTool } from "./tools/enrichment/enrich-batch.js";
import { createDetectRelationshipsTool } from "./tools/enrichment/detect-relationships.js";
import { createSearchACOsTool } from "./tools/search/search-acos.js";
import { createFindSimilarTool } from "./tools/search/find-similar.js";
import { createValidateVaultTool } from "./tools/vault/validate-vault.js";
import { createExportACOTool } from "./tools/vault/export-aco.js";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface EnrichmentConfig {
  /** Provider connection details (Anthropic, OpenAI, Ollama). */
  providers: ProviderConfig;
  /** Default pipelines to run when no pipelines are specified. Not currently used by server — per-tool default. */
  defaultPipelines?: string[];
}

export interface ACPMCPServerConfig {
  /** Storage adapter (filesystem, in-memory, etc.). */
  storage: IStorageAdapter;
  /** Enrichment configuration. Optional — enrichment tools return an error if not configured. */
  enrichment?: EnrichmentConfig;
  /** MCP server metadata. */
  server?: {
    name?: string;
    version?: string;
  };
}

// ---------------------------------------------------------------------------
// ACPMCPServer
// ---------------------------------------------------------------------------

/**
 * ACPMCPServer — wraps the MCP SDK Server and registers all ACP tools.
 *
 * Usage:
 *   const server = new ACPMCPServer({ storage, enrichment });
 *   await server.start(); // blocks, communicates over stdio
 */
export class ACPMCPServer {
  private readonly mcpServer: Server;
  private readonly config: ACPMCPServerConfig;

  constructor(config: ACPMCPServerConfig) {
    this.config = config;

    this.mcpServer = new Server(
      {
        name: config.server?.name ?? "acp-server",
        version: config.server?.version ?? "0.1.0",
      },
      {
        capabilities: { tools: {} },
        instructions: `ACP MCP server — create, read, update, delete, enrich, and search Atomic Content Objects (ACOs).

Data model:
- ACO: Atomic Content Object — the fundamental unit. Has YAML frontmatter + Markdown body.
- Container: an ACO that groups other ACOs (by id references).
- Collection: a named, ordered set of Containers or ACOs.

Common workflows:
1. Create & enrich: create_aco → enrich_aco → read_aco
2. Browse: list_acos → read_aco
3. Search: search_acos (text search), detect_relationships (tag/entity overlap)
4. Batch enrich: enrich_batch (by id list or container)
5. Validate: validate_vault
6. Export: export_aco (markdown or JSON)

All IDs are UUID v7 strings. Tags and entities are the primary signals for relationship detection.`,
      }
    );

    this.registerTools();
    this.bindHandlers();
  }

  // ---------------------------------------------------------------------------
  // Private: register all tools into the module-level registry
  // ---------------------------------------------------------------------------

  private registerTools(): void {
    // Clear any previously registered tools (e.g. in tests)
    clearRegistry();

    const { storage, enrichment } = this.config;

    // ACO tools
    registerTool("create_aco", createCreateACOTool(storage));
    registerTool("read_aco", createReadACOTool(storage));
    registerTool("update_aco", createUpdateACOTool(storage));
    registerTool("delete_aco", createDeleteACOTool(storage));
    registerTool("list_acos", createListACOsTool(storage));

    // Container tools
    registerTool("create_container", createCreateContainerTool(storage));
    registerTool("read_container", createReadContainerTool(storage));
    registerTool("list_containers", createListContainersTool(storage));

    // Enrichment tools (require enrichment config)
    if (enrichment) {
      registerTool("enrich_aco", createEnrichACOTool(storage, enrichment));
      registerTool("enrich_batch", createEnrichBatchTool(storage, enrichment));
    } else {
      registerTool("enrich_aco", this.makeUnconfiguredTool("enrich_aco", "enrich_aco requires enrichment providers to be configured in ACPMCPServerConfig."));
      registerTool("enrich_batch", this.makeUnconfiguredTool("enrich_batch", "enrich_batch requires enrichment providers to be configured in ACPMCPServerConfig."));
    }

    registerTool("detect_relationships", createDetectRelationshipsTool(storage));

    // Search tools
    registerTool("search_acos", createSearchACOsTool(storage));
    registerTool("find_similar", createFindSimilarTool(storage));

    // Vault tools
    registerTool("validate_vault", createValidateVaultTool(storage));
    registerTool("export_aco", createExportACOTool(storage));
  }

  /**
   * Create a stub tool entry that always returns a configuration error.
   * Used for tools that require enrichment when enrichment is not configured.
   */
  private makeUnconfiguredTool(name: string, message: string) {
    return {
      definition: {
        name,
        description: message,
        inputSchema: z.object({}),
      },
      handler: async () => ({ success: false as const, error: message }),
    };
  }

  // ---------------------------------------------------------------------------
  // Private: bind MCP SDK request handlers
  // ---------------------------------------------------------------------------

  private bindHandlers(): void {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: getAllTools().map(adaptToolForMCP) };
    });

    this.mcpServer.setRequestHandler(
      CallToolRequestSchema,
      async (request: CallToolRequest) => {
        const toolName = request.params.name;
        const toolInput = request.params.arguments ?? {};

        if (!toolExists(toolName)) {
          throw new Error(`Unknown tool: ${toolName}`);
        }

        const handler = getToolHandler(toolName);
        if (!handler) {
          throw new Error(`No handler registered for tool: ${toolName}`);
        }

        const result = await handler(toolInput);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          ...(result.success === false && { isError: true }),
        };
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Public: start the server
  // ---------------------------------------------------------------------------

  /**
   * Connect to the stdio transport and begin serving requests.
   *
   * IMPORTANT: This redirects console.log/info/warn to stderr.
   * stdout must remain clean for JSON-RPC — the MCP SDK writes there directly.
   */
  async start(): Promise<void> {
    // Redirect console to stderr so library noise doesn't corrupt the JSON-RPC stream
    console.log = (...args: unknown[]) =>
      process.stderr.write(args.map(String).join(" ") + "\n");
    console.info = (...args: unknown[]) =>
      process.stderr.write(args.map(String).join(" ") + "\n");
    console.warn = (...args: unknown[]) =>
      process.stderr.write(args.map(String).join(" ") + "\n");

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }
}
