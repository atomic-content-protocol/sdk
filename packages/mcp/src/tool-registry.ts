import type { ACPToolDefinition, ToolEntry, ToolHandler } from "./types/tool.js";

/**
 * Module-level registry: maps tool name → ToolEntry.
 * Populated by the server during initialization via registerTool().
 */
const toolRegistry: Record<string, ToolEntry> = {};

/**
 * Register a tool. Throws if a tool with the same name is already registered.
 */
export function registerTool(name: string, entry: ToolEntry): void {
  if (toolRegistry[name]) {
    throw new Error(`Tool '${name}' is already registered`);
  }
  toolRegistry[name] = entry;
}

/**
 * Return all registered tool definitions (no handlers).
 */
export function getAllTools(): ACPToolDefinition[] {
  return Object.values(toolRegistry).map((entry) => entry.definition);
}

/**
 * Return the handler for a given tool name, or null if not found.
 */
export function getToolHandler(name: string): ToolHandler | null {
  const entry = toolRegistry[name];
  return entry ? entry.handler : null;
}

/**
 * Return true if a tool with the given name is registered.
 */
export function toolExists(name: string): boolean {
  return name in toolRegistry;
}

/**
 * Clear all registered tools. Used for testing.
 */
export function clearRegistry(): void {
  for (const key of Object.keys(toolRegistry)) {
    delete toolRegistry[key];
  }
}
