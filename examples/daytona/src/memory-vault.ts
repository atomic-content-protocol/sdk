/**
 * Read-only ACO list that sorts the same way as FilesystemAdapter.listACOs.
 * The browser page and the Node parity check both use it so `list_acos` and
 * `find_similar` see the same objects the filesystem vault returns.
 */

import type { ACO, IStorageAdapter, ListOptions } from "@atomic-content-protocol/core";

function applyList(items: ACO[], options?: ListOptions): ACO[] {
  const { limit, offset = 0, sortBy = "created", order = "asc" } = options ?? {};
  const sorted = [...items].sort((a, b) => {
    const va = String(a.frontmatter[sortBy] ?? "");
    const vb = String(b.frontmatter[sortBy] ?? "");
    return order === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  const sliced = sorted.slice(offset);
  return limit !== undefined ? sliced.slice(0, limit) : sliced;
}

export function memoryVault(acos: ACO[]): IStorageAdapter {
  return {
    async getACO(id: string) {
      return acos.find((aco) => String(aco.frontmatter["id"] ?? "") === id) ?? null;
    },
    async putACO() {
      throw new Error("memory vault is read-only");
    },
    async deleteACO() {
      throw new Error("memory vault is read-only");
    },
    async listACOs(options?: ListOptions) {
      return applyList(acos, options);
    },
    async queryACOs() {
      return [...acos];
    },
    async getContainer() {
      return null;
    },
    async putContainer() {
      throw new Error("memory vault is read-only");
    },
    async listContainers() {
      return [];
    },
    async getCollection() {
      return null;
    },
    async putCollection() {
      throw new Error("memory vault is read-only");
    },
    async listCollections() {
      return [];
    },
    async getEdgesFrom() {
      return [];
    },
    async getEdgesTo() {
      return [];
    },
  };
}
