/**
 * FilesystemAdapter — IStorageAdapter backed by a local directory ("vault").
 *
 * Layout inside `vaultPath`:
 *
 *   {vaultPath}/
 *     {id}.md                  — ACO files
 *     .containers/{id}.md      — Container files
 *     .collections/{id}.md     — Collection files
 *     .acp/
 *       index.json             — Fast id→metadata mapping (rebuilt on demand)
 *
 * ACO files are YAML-frontmatter + Markdown documents parsed/serialised by
 * the `io/parse` and `io/serialize` modules.
 *
 * Index format:
 * {
 *   "version": 1,
 *   "entries": {
 *     "<uuid>": { "title": "…", "source_type": "…", "created": "…", "tags": […], "status": "…" }
 *   },
 *   "updated_at": "<ISO timestamp>"
 * }
 *
 * The index is used by `listACOs` and `queryACOs` to avoid reading every .md
 * file on each call. It is updated on every `putACO` / `deleteACO` and can
 * be fully rebuilt via `rebuildIndex()`.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { parseACO } from "../io/parse.js";
import { serializeACO } from "../io/serialize.js";
import type { ACO, Container, Collection } from "../types/aco.js";
import type {
  IStorageAdapter,
  ListOptions,
  ACOQuery,
  SimilarityOptions,
  SearchResult,
} from "./adapter.interface.js";

// ---------------------------------------------------------------------------
// Index types
// ---------------------------------------------------------------------------

interface IndexEntry {
  title: string;
  source_type: string;
  created: string;
  tags: string[];
  status: string;
  modified?: string;
}

interface VaultIndex {
  version: 1;
  entries: Record<string, IndexEntry>;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read and parse a file as UTF-8. Returns `null` if the file does not exist. */
async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

interface NodeErrnoException extends Error {
  code?: string;
}

function isNodeError(err: unknown): err is NodeErrnoException {
  return err instanceof Error && "code" in err;
}

/** Apply `ListOptions` pagination and sorting to an array. */
function applyListOptions<T extends { frontmatter: Record<string, unknown> }>(
  items: T[],
  options?: ListOptions
): T[] {
  const { limit, offset = 0, sortBy = "created", order = "asc" } = options ?? {};

  const sorted = [...items].sort((a, b) => {
    const va = String(a.frontmatter[sortBy] ?? "");
    const vb = String(b.frontmatter[sortBy] ?? "");
    return order === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  const sliced = sorted.slice(offset);
  return limit !== undefined ? sliced.slice(0, limit) : sliced;
}

// ---------------------------------------------------------------------------
// FilesystemAdapter
// ---------------------------------------------------------------------------

export class FilesystemAdapter implements IStorageAdapter {
  private readonly vaultPath: string;
  private readonly containersPath: string;
  private readonly collectionsPath: string;
  private readonly acpDir: string;
  private readonly indexPath: string;

  /** Set to true after `ensureDirectories()` has run successfully. */
  private initialised = false;

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath);
    this.containersPath = path.join(this.vaultPath, ".containers");
    this.collectionsPath = path.join(this.vaultPath, ".collections");
    this.acpDir = path.join(this.vaultPath, ".acp");
    this.indexPath = path.join(this.acpDir, "index.json");
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  /**
   * Ensure the vault directory tree exists.
   * Called lazily on first write and on every read that touches the index.
   */
  private async ensureDirectories(): Promise<void> {
    if (this.initialised) return;
    await fs.mkdir(this.vaultPath, { recursive: true });
    await fs.mkdir(this.containersPath, { recursive: true });
    await fs.mkdir(this.collectionsPath, { recursive: true });
    await fs.mkdir(this.acpDir, { recursive: true });
    this.initialised = true;
  }

  // -------------------------------------------------------------------------
  // Index helpers
  // -------------------------------------------------------------------------

  private async readIndex(): Promise<VaultIndex> {
    await this.ensureDirectories();
    const raw = await readFileSafe(this.indexPath);
    if (raw === null) {
      return { version: 1, entries: {}, updated_at: new Date().toISOString() };
    }
    return JSON.parse(raw) as VaultIndex;
  }

  private async writeIndex(index: VaultIndex): Promise<void> {
    index.updated_at = new Date().toISOString();
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  private indexEntryFromACO(aco: ACO): IndexEntry {
    const fm = aco.frontmatter;
    return {
      title: String(fm["title"] ?? ""),
      source_type: String(fm["source_type"] ?? ""),
      created: String(fm["created"] ?? ""),
      tags: Array.isArray(fm["tags"]) ? (fm["tags"] as string[]) : [],
      status: String(fm["status"] ?? ""),
      modified: fm["modified"] !== undefined ? String(fm["modified"]) : undefined,
    };
  }

  /**
   * Rebuild `.acp/index.json` by scanning all ACO `.md` files in the vault root.
   *
   * This is a recovery / maintenance operation. Call it if the index gets out
   * of sync with the filesystem (e.g. after manual file edits).
   */
  async rebuildIndex(): Promise<void> {
    await this.ensureDirectories();
    const files = await fs.readdir(this.vaultPath);
    const index: VaultIndex = {
      version: 1,
      entries: {},
      updated_at: new Date().toISOString(),
    };

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(this.vaultPath, file);
      const raw = await readFileSafe(filePath);
      if (raw === null) continue;
      const result = parseACO(raw);
      const id = String(result.frontmatter["id"] ?? "");
      if (!id) continue;
      index.entries[id] = this.indexEntryFromACO(result);
    }

    await this.writeIndex(index);
  }

  // -------------------------------------------------------------------------
  // ACO CRUD
  // -------------------------------------------------------------------------

  async getACO(id: string): Promise<ACO | null> {
    await this.ensureDirectories();
    const filePath = path.join(this.vaultPath, `${id}.md`);
    const raw = await readFileSafe(filePath);
    if (raw === null) return null;
    const result = parseACO(raw);
    return { frontmatter: result.frontmatter, body: result.body };
  }

  async putACO(aco: ACO): Promise<void> {
    await this.ensureDirectories();
    const id = String(aco.frontmatter["id"] ?? "");
    if (!id) throw new Error("putACO: aco.frontmatter.id is required");

    const filePath = path.join(this.vaultPath, `${id}.md`);
    const serialised = serializeACO(aco.frontmatter, aco.body);
    await fs.writeFile(filePath, serialised, "utf-8");

    // Update index
    const index = await this.readIndex();
    index.entries[id] = this.indexEntryFromACO(aco);
    await this.writeIndex(index);
  }

  async deleteACO(id: string): Promise<void> {
    await this.ensureDirectories();
    const filePath = path.join(this.vaultPath, `${id}.md`);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") return; // already gone
      throw err;
    }

    // Remove from index
    const index = await this.readIndex();
    delete index.entries[id];
    await this.writeIndex(index);
  }

  async listACOs(options?: ListOptions): Promise<ACO[]> {
    const index = await this.readIndex();
    const ids = Object.keys(index.entries);

    // Hydrate each ACO from disk
    const acos: ACO[] = [];
    for (const id of ids) {
      const aco = await this.getACO(id);
      if (aco !== null) acos.push(aco);
    }

    return applyListOptions(acos, options);
  }

  async queryACOs(query: ACOQuery): Promise<ACO[]> {
    const index = await this.readIndex();
    const candidateIds: string[] = [];

    for (const [id, entry] of Object.entries(index.entries)) {
      // source_type filter (OR)
      if (
        query.source_type &&
        query.source_type.length > 0 &&
        !query.source_type.includes(entry.source_type)
      ) {
        continue;
      }

      // status filter (OR)
      if (
        query.status &&
        query.status.length > 0 &&
        !query.status.includes(entry.status)
      ) {
        continue;
      }

      // tags filter (OR — at least one tag must match)
      if (query.tags && query.tags.length > 0) {
        const hasTag = query.tags.some((t) => entry.tags.includes(t));
        if (!hasTag) continue;
      }

      // created_after
      if (query.created_after && entry.created < query.created_after) {
        continue;
      }

      // created_before
      if (query.created_before && entry.created >= query.created_before) {
        continue;
      }

      candidateIds.push(id);
    }

    // Hydrate and apply remaining filters that need the full document
    const results: ACO[] = [];
    for (const id of candidateIds) {
      const aco = await this.getACO(id);
      if (aco === null) continue;

      // visibility filter (needs full frontmatter)
      if (query.visibility && query.visibility.length > 0) {
        const vis = String(aco.frontmatter["visibility"] ?? "");
        if (!query.visibility.includes(vis)) continue;
      }

      // full-text search (title + body)
      if (query.search) {
        const needle = query.search.toLowerCase();
        const title = String(aco.frontmatter["title"] ?? "").toLowerCase();
        const body = aco.body.toLowerCase();
        if (!title.includes(needle) && !body.includes(needle)) continue;
      }

      results.push(aco);
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Container CRUD
  // -------------------------------------------------------------------------

  async getContainer(id: string): Promise<Container | null> {
    await this.ensureDirectories();
    const filePath = path.join(this.containersPath, `${id}.md`);
    const raw = await readFileSafe(filePath);
    if (raw === null) return null;
    const result = parseACO(raw);
    return { frontmatter: result.frontmatter, body: result.body };
  }

  async putContainer(container: Container): Promise<void> {
    await this.ensureDirectories();
    const id = String(container.frontmatter["id"] ?? "");
    if (!id) throw new Error("putContainer: container.frontmatter.id is required");

    const filePath = path.join(this.containersPath, `${id}.md`);
    const serialised = serializeACO(container.frontmatter, container.body);
    await fs.writeFile(filePath, serialised, "utf-8");
  }

  async listContainers(options?: ListOptions): Promise<Container[]> {
    await this.ensureDirectories();
    const files = await fs.readdir(this.containersPath);
    const containers: Container[] = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(this.containersPath, file);
      const raw = await readFileSafe(filePath);
      if (raw === null) continue;
      const result = parseACO(raw);
      containers.push({ frontmatter: result.frontmatter, body: result.body });
    }

    return applyListOptions(containers, options);
  }

  // -------------------------------------------------------------------------
  // Collection CRUD
  // -------------------------------------------------------------------------

  async getCollection(id: string): Promise<Collection | null> {
    await this.ensureDirectories();
    const filePath = path.join(this.collectionsPath, `${id}.md`);
    const raw = await readFileSafe(filePath);
    if (raw === null) return null;
    const result = parseACO(raw);
    return { frontmatter: result.frontmatter, body: result.body };
  }

  async putCollection(collection: Collection): Promise<void> {
    await this.ensureDirectories();
    const id = String(collection.frontmatter["id"] ?? "");
    if (!id) throw new Error("putCollection: collection.frontmatter.id is required");

    const filePath = path.join(this.collectionsPath, `${id}.md`);
    const serialised = serializeACO(collection.frontmatter, collection.body);
    await fs.writeFile(filePath, serialised, "utf-8");
  }

  async listCollections(options?: ListOptions): Promise<Collection[]> {
    await this.ensureDirectories();
    const files = await fs.readdir(this.collectionsPath);
    const collections: Collection[] = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(this.collectionsPath, file);
      const raw = await readFileSafe(filePath);
      if (raw === null) continue;
      const result = parseACO(raw);
      collections.push({ frontmatter: result.frontmatter, body: result.body });
    }

    return applyListOptions(collections, options);
  }

  // -------------------------------------------------------------------------
  // Relationship traversal
  // -------------------------------------------------------------------------

  async getEdgesFrom(
    acoId: string
  ): Promise<Array<{ rel_type: string; target_id: string; confidence?: number }>> {
    const aco = await this.getACO(acoId);
    if (aco === null) return [];

    const relationships = aco.frontmatter["relationships"];
    if (!Array.isArray(relationships)) return [];

    return relationships
      .filter(
        (edge): edge is Record<string, unknown> =>
          typeof edge === "object" && edge !== null
      )
      .map((edge) => ({
        rel_type: String(edge["rel_type"] ?? ""),
        target_id: String(edge["target_id"] ?? ""),
        confidence:
          typeof edge["confidence"] === "number" ? edge["confidence"] : undefined,
      }))
      .filter((edge) => edge.rel_type && edge.target_id);
  }

  async getEdgesTo(
    acoId: string
  ): Promise<Array<{ rel_type: string; source_id: string; confidence?: number }>> {
    // Basic scan: check every indexed ACO for outbound edges pointing to acoId.
    // Adapters with a reverse index (e.g. SQLite) can override this.
    const index = await this.readIndex();
    const results: Array<{
      rel_type: string;
      source_id: string;
      confidence?: number;
    }> = [];

    for (const sourceId of Object.keys(index.entries)) {
      const outbound = await this.getEdgesFrom(sourceId);
      for (const edge of outbound) {
        if (edge.target_id === acoId) {
          results.push({
            rel_type: edge.rel_type,
            source_id: sourceId,
            confidence: edge.confidence,
          });
        }
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Optional: embeddings
  // These methods are omitted from FilesystemAdapter intentionally.
  // Implement putEmbedding / findSimilar in a vector-store adapter instead.
  // -------------------------------------------------------------------------

  // putEmbedding and findSimilar are NOT implemented here.
  // Declared as optional on IStorageAdapter; callers must guard with typeof check.
  putEmbedding?: (
    id: string,
    vector: number[],
    model: string
  ) => Promise<void>;

  findSimilar?: (
    vector: number[],
    options?: SimilarityOptions
  ) => Promise<SearchResult[]>;
}
