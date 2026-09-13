import type { ACO, IStorageAdapter, ListOptions } from "@atomic-content-protocol/core";

const PAGE_SIZE = 200;

/**
 * Load every ACO in the vault by paging through `listACOs`, so tools never
 * silently truncate at an arbitrary cap.
 */
export async function listAllACOs(storage: IStorageAdapter): Promise<ACO[]> {
  const all: ACO[] = [];
  let offset = 0;
  for (;;) {
    const page = await storage.listACOs({ limit: PAGE_SIZE, offset, sortBy: "created", order: "asc" });
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }
  return all;
}

/** Sort ACOs by a frontmatter field, matching the adapter's `ListOptions` semantics. */
export function sortACOs(acos: ACO[], sortBy: NonNullable<ListOptions["sortBy"]>, order: NonNullable<ListOptions["order"]>): ACO[] {
  return [...acos].sort((a, b) => {
    const va = String(a.frontmatter[sortBy] ?? "");
    const vb = String(b.frontmatter[sortBy] ?? "");
    return order === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
  });
}

/** Load several ACOs by id, dropping the ones that do not exist. */
export async function loadACOs(storage: IStorageAdapter, ids: string[]): Promise<ACO[]> {
  const results = await Promise.all(ids.map((id) => storage.getACO(id).catch(() => null)));
  return results.filter((a): a is ACO => a !== null);
}
