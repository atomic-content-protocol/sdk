import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { IStorageAdapter } from "@atomic-content-protocol/core";
import { ProviderRouter } from "@atomic-content-protocol/enrichment";
import type { IEnrichmentProvider, ProviderConfig, RouterOptions } from "@atomic-content-protocol/enrichment";

import { ToolRegistry } from "./tool-registry.js";
import { adaptToolForMCP } from "./tool-adapter.js";
import { EnrichmentNotConfiguredError, type ToolContext } from "./context.js";
import { PKG, TOOL } from "./tool-id.js";
import type { ToolEntry, ToolOutput } from "./types/tool.js";

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
  /** Provider connection details (Anthropic, OpenAI, Ollama). Builds a `ProviderRouter`. */
  providers?: ProviderConfig;
  /** Router tuning (timeouts, breaker thresholds, callbacks). */
  routerOptions?: RouterOptions;
  /**
   * Bring your own provider instead of `providers` — any `IEnrichmentProvider`
   * (a custom router, a mock in tests, …). Takes precedence over `providers`.
   */
  provider?: IEnrichmentProvider;
}

export interface ACPMCPServerConfig {
  /** Storage adapter (filesystem, in-memory, etc.). */
  storage: IStorageAdapter;
  /** Enrichment configuration. Optional — enrichment tools return an error if not configured. */
  enrichment?: EnrichmentConfig;
  /** MCP server metadata. Defaults to this package's name and version. */
  server?: {
    name?: string;
    version?: string;
  };
}

// ---------------------------------------------------------------------------
// ACPMCPServer
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `ACP MCP server — create, read, update, delete, enrich, and search Atomic Content Objects (ACOs).

Data model:
- ACO: Atomic Content Object — the fundamental unit. Has YAML frontmatter + Markdown body.
- Container: an ACO that groups other ACOs (by id references).
- Collection: a named, ordered set of Containers or ACOs.

Common workflows:
1. Create & enrich: create_aco → enrich_aco → read_aco
2. Browse: list_acos → read_aco
3. Search: search_acos (full text), find_similar (vectors or overlap)
4. Relationships: detect_relationships → review → update_aco { relationships: [...] }
5. Batch enrich: enrich_batch (by id list or container). Add the 'embed' pipeline to enable vector search.
6. Validate: validate_vault
7. Export: export_aco (markdown or JSON)

All IDs are UUID v7 strings. Enrichment never overwrites a field that already has a value unless force=true.`;

/**
 * ACPMCPServer — wraps the MCP SDK Server and registers all ACP tools.
 *
 * Usage:
 *   const server = new ACPMCPServer({ storage, enrichment });
 *   await server.start(); // blocks, communicates over stdio
 *
 * Each instance owns its tool registry and (lazily) one shared enrichment
 * provider, so several servers can coexist in one process.
 */
export class ACPMCPServer {
  private readonly mcpServer: Server;
  private readonly registry = new ToolRegistry();
  private readonly context: ToolContext;
  private provider: IEnrichmentProvider | null = null;

  constructor(private readonly config: ACPMCPServerConfig) {
    this.mcpServer = new Server(
      {
        name: config.server?.name ?? PKG.name,
        version: config.server?.version ?? PKG.version,
      },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
    );

    const enrichment = config.enrichment;
    const hasEnrichment = Boolean(enrichment?.provider || enrichment?.providers);

    this.context = {
      storage: config.storage,
      hasEnrichment,
      toolId: TOOL,
      getProvider: () => {
        if (!hasEnrichment || !enrichment) throw new EnrichmentNotConfiguredError("This tool");
        if (!this.provider) {
          this.provider =
            enrichment.provider ?? ProviderRouter.fromConfig(enrichment.providers as ProviderConfig, enrichment.routerOptions);
        }
        return this.provider;
      },
    };

    this.registerTools();
    this.bindHandlers();
  }

  // ---------------------------------------------------------------------------
  // Private: register all tools into this instance's registry
  // ---------------------------------------------------------------------------

  private registerTools(): void {
    const ctx = this.context;
    const reg = (entry: ToolEntry) => this.registry.register(entry.definition.name, entry);

    // ACO tools
    reg(createCreateACOTool(ctx));
    reg(createReadACOTool(ctx));
    reg(createUpdateACOTool(ctx));
    reg(createDeleteACOTool(ctx));
    reg(createListACOsTool(ctx));

    // Container tools
    reg(createCreateContainerTool(ctx));
    reg(createReadContainerTool(ctx));
    reg(createListContainersTool(ctx));

    // Enrichment tools
    if (ctx.hasEnrichment) {
      reg(createEnrichACOTool(ctx));
      reg(createEnrichBatchTool(ctx));
    } else {
      reg(this.unconfiguredTool("enrich_aco"));
      reg(this.unconfiguredTool("enrich_batch"));
    }
    reg(createDetectRelationshipsTool(ctx));

    // Search tools
    reg(createSearchACOsTool(ctx));
    reg(createFindSimilarTool(ctx));

    // Vault tools
    reg(createValidateVaultTool(ctx));
    reg(createExportACOTool(ctx));
  }

  /** Stub for tools that need enrichment when none is configured. */
  private unconfiguredTool(name: string): ToolEntry {
    const message = new EnrichmentNotConfiguredError(name).message;
    return {
      definition: { name, description: message, inputSchema: z.object({}).passthrough() },
      handler: async () => ({ success: false as const, error: message }),
    };
  }

  // ---------------------------------------------------------------------------
  // Private: bind MCP SDK request handlers
  // ---------------------------------------------------------------------------

  private bindHandlers(): void {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.listTools() }));

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const result = await this.callTool(request.params.name, request.params.arguments ?? {});
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        ...(result.success === false && { isError: true }),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Tool definitions in MCP wire shape. */
  listTools() {
    return this.registry.definitions().map(adaptToolForMCP);
  }

  /** Registered tool names, in registration order. */
  get toolNames(): string[] {
    return this.registry.names();
  }

  /**
   * Invoke a tool directly (no transport). Throws `McpError(MethodNotFound)`
   * for unknown tools; tool-level failures come back as `{ success: false }`.
   */
  async callTool(name: string, input: unknown): Promise<ToolOutput> {
    const handler = this.registry.handler(name);
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return handler(input);
  }

  /**
   * Connect to the stdio transport and begin serving requests.
   *
   * IMPORTANT: This redirects console.log/info/warn to stderr.
   * stdout must remain clean for JSON-RPC — the MCP SDK writes there directly.
   */
  async start(): Promise<void> {
    const toStderr = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
    console.log = toStderr;
    console.info = toStderr;
    console.warn = toStderr;

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }

  /** Close the underlying MCP server / transport. */
  async close(): Promise<void> {
    await this.mcpServer.close();
  }
}
