import { describe, expect, it } from "vitest";
import type { IStorageAdapter } from "../storage/adapter.interface.js";
import { getRelatedACOs } from "./traverse.js";

type Edge = { rel_type: string; target_id: string; confidence?: number };

/** Minimal adapter exposing only what traversal needs. */
function graph(edges: Record<string, Edge[]>): IStorageAdapter {
  return {
    getEdgesFrom: async (id: string) => edges[id] ?? [],
  } as unknown as IStorageAdapter;
}

describe("getRelatedACOs", () => {
  const g = graph({
    a: [
      { rel_type: "references", target_id: "b" },
      { rel_type: "related", target_id: "c" },
      { rel_type: "references", target_id: "https://example.com/ext" },
    ],
    b: [
      { rel_type: "supports", target_id: "d" },
      { rel_type: "related", target_id: "a" },
    ],
    c: [{ rel_type: "related", target_id: "d" }],
    d: [{ rel_type: "related", target_id: "a" }],
  });

  it("returns direct neighbours at depth 1 (default), sorted by id, skipping external URLs", async () => {
    const r = await getRelatedACOs(g, "a");
    expect(r).toEqual([
      { id: "b", rel_type: "references", distance: 1 },
      { id: "c", rel_type: "related", distance: 1 },
    ]);
  });

  it("walks breadth-first with shortest distance and handles cycles", async () => {
    const r = await getRelatedACOs(g, "a", { depth: 3 });
    expect(r.map((x) => [x.id, x.distance])).toEqual([
      ["b", 1],
      ["c", 1],
      ["d", 2],
    ]);
    // 'a' never appears (visited from the start), and 'd' reported once
    expect(r.filter((x) => x.id === "a")).toHaveLength(0);
  });

  it("filters by rel_type", async () => {
    const r = await getRelatedACOs(g, "a", { depth: 2, relTypes: ["references"] });
    expect(r).toEqual([{ id: "b", rel_type: "references", distance: 1 }]);
  });

  it("depth 0 returns nothing; unknown start returns nothing", async () => {
    expect(await getRelatedACOs(g, "a", { depth: 0 })).toEqual([]);
    expect(await getRelatedACOs(g, "zzz")).toEqual([]);
  });

  it("records the edge that first reached each node", async () => {
    const r = await getRelatedACOs(g, "b", { depth: 2 });
    expect(r).toEqual([
      { id: "a", rel_type: "related", distance: 1 },
      { id: "d", rel_type: "supports", distance: 1 },
      { id: "c", rel_type: "related", distance: 2 },
    ]);
  });
});
