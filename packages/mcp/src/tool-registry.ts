import type { ACPToolDefinition, ToolEntry, ToolHandler } from "./types/tool.js";

/**
 * ToolRegistry — maps tool name → ToolEntry for one server instance.
 *
 * Each `ACPMCPServer` owns its own registry, so two servers in one process
 * (e.g. two vaults, or tests) never clobber each other.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolEntry>();

  /** Register a tool. Throws if a tool with the same name is already registered. */
  register(name: string, entry: ToolEntry): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool '${name}' is already registered`);
    }
    this.tools.set(name, entry);
  }

  /** All registered tool definitions (no handlers), in registration order. */
  definitions(): ACPToolDefinition[] {
    return [...this.tools.values()].map((entry) => entry.definition);
  }

  /** Handler for `name`, or null if not registered. */
  handler(name: string): ToolHandler | null {
    return this.tools.get(name)?.handler ?? null;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  clear(): void {
    this.tools.clear();
  }
}

// ---------------------------------------------------------------------------
// Module-level default registry — kept for backwards compatibility with the
// functional API exported in 0.1.x. `ACPMCPServer` no longer uses it.
// ---------------------------------------------------------------------------

const defaultRegistry = new ToolRegistry();

/** @deprecated Use `new ToolRegistry()` — this shared instance is process-global. */
export function registerTool(name: string, entry: ToolEntry): void {
  defaultRegistry.register(name, entry);
}

/** @deprecated Use `ToolRegistry#definitions()`. */
export function getAllTools(): ACPToolDefinition[] {
  return defaultRegistry.definitions();
}

/** @deprecated Use `ToolRegistry#handler()`. */
export function getToolHandler(name: string): ToolHandler | null {
  return defaultRegistry.handler(name);
}

/** @deprecated Use `ToolRegistry#has()`. */
export function toolExists(name: string): boolean {
  return defaultRegistry.has(name);
}

/** @deprecated Use `ToolRegistry#clear()`. */
export function clearRegistry(): void {
  defaultRegistry.clear();
}
