/**
 * The same MCP tool handlers the Node bench calls through ACPMCPServer,
 * without the stdio server. `hasEnrichment` stays false so find_similar uses
 * content overlap.
 */

import type { IStorageAdapter } from "@atomic-content-protocol/core";
import { createListACOsTool } from "../../../packages/mcp/src/tools/aco/list-acos.js";
import { createReadACOTool } from "../../../packages/mcp/src/tools/aco/read-aco.js";
import { createFindSimilarTool } from "../../../packages/mcp/src/tools/search/find-similar.js";
import type { ToolRunner } from "./score.js";

export function toolsFromStorage(storage: IStorageAdapter): ToolRunner {
  const context = {
    storage,
    hasEnrichment: false,
    toolId: "examples/daytona",
    getProvider() {
      throw new Error("enrichment is not configured");
    },
  };
  const list = createListACOsTool(context);
  const similar = createFindSimilarTool(context);
  const read = createReadACOTool(context);
  return {
    listAcos: (args) => list.handler(args),
    findSimilar: (args) => similar.handler(args),
    readAco: (args) => read.handler(args),
  };
}
