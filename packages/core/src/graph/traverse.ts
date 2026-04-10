/**
 * Graph traversal utilities for ACP relationship edges.
 *
 * ACP relationship edges are stored as outbound edges on each ACO's
 * `relationships` frontmatter field. This module provides utilities to walk
 * those edges across one or more hops, producing a flat list of reachable
 * objects with their traversal distance and the edge type that connected them.
 *
 * See: schema/edge.schema.ts, storage/adapter.interface.ts
 */

import type { IStorageAdapter } from "../storage/adapter.interface.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single node reached during graph traversal. */
export interface TraversalResult {
  /** UUID of the reached ACO. */
  id: string;
  /** The relationship type (`rel_type`) on the edge that introduced this node. */
  rel_type: string;
  /**
   * Number of hops from the starting ACO.
   * `1` means the node is directly connected; `2` means two hops away, etc.
   */
  distance: number;
}

/** Options for `getRelatedACOs`. */
export interface TraversalOptions {
  /**
   * Maximum number of hops to traverse.
   * Depth 1 returns only direct neighbours. Depth 2 returns neighbours of
   * neighbours, and so on.
   * Defaults to 1.
   */
  depth?: number;
  /**
   * Optional allow-list of relationship types to follow.
   * When provided, only edges whose `rel_type` is in this array will be
   * traversed. When omitted, all edge types are followed.
   */
  relTypes?: string[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Walk outbound relationship edges from `acoId` up to `options.depth` hops.
 *
 * The traversal is breadth-first. Cycles are handled by keeping a visited
 * set — each node is reported at most once, at its shortest distance.
 *
 * @param storage  Any IStorageAdapter implementation.
 * @param acoId    Starting ACO UUID.
 * @param options  Traversal options (depth, relType filter).
 * @returns        Flat array of reachable nodes, sorted by ascending distance
 *                 then `id`.
 */
export async function getRelatedACOs(
  storage: IStorageAdapter,
  acoId: string,
  options?: TraversalOptions
): Promise<TraversalResult[]> {
  const maxDepth = options?.depth ?? 1;
  const relTypeFilter = options?.relTypes;

  const visited = new Set<string>([acoId]);
  const results: TraversalResult[] = [];

  // BFS queue: [currentId, currentDepth]
  const queue: Array<[string, number]> = [[acoId, 0]];

  while (queue.length > 0) {
    const [currentId, currentDepth] = queue.shift()!;

    if (currentDepth >= maxDepth) continue;

    const edges = await storage.getEdgesFrom(currentId);

    for (const edge of edges) {
      // Apply rel_type filter if specified
      if (relTypeFilter && relTypeFilter.length > 0) {
        if (!relTypeFilter.includes(edge.rel_type)) continue;
      }

      const targetId = edge.target_id;

      // Skip already-visited nodes (shortest-path wins)
      if (visited.has(targetId)) continue;

      // Skip non-UUID targets (external URLs are not traversable ACOs)
      if (targetId.startsWith("http://") || targetId.startsWith("https://")) {
        continue;
      }

      visited.add(targetId);
      const distance = currentDepth + 1;
      results.push({ id: targetId, rel_type: edge.rel_type, distance });

      if (distance < maxDepth) {
        queue.push([targetId, distance]);
      }
    }
  }

  // Sort by distance ascending, then id for deterministic output
  return results.sort((a, b) =>
    a.distance !== b.distance ? a.distance - b.distance : a.id.localeCompare(b.id)
  );
}
