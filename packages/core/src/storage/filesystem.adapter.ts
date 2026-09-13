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
 *       embeddings.json        — Optional flat vector store
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
 * be fully rebuilt via `rebuildIndex()`. A corrupt or foreign index is
 * rebuilt automatically on the next read.
 *
 * Concurrency: every write goes through an in-process mutex and every file is
 * written atomically (temp file + rename), so concurrent `putACO` calls from
 * the same process never tear the index or leave half-written documents.
 * Multi-process coordination is out of scope, as documented on the interface.
 *
 * Security: object ids become file names. Ids are validated against a strict
 * character allowlist before any path is built, so an id sourced from an
 * untrusted document can never escape the vault or reach the dot-directories.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import { parseACO } from "../io/parse.js";
import { serializeACO } from "../io/serialize.js";
import type { ACO, Container, Collection } from "../types/aco.js";
import { ValidationError } from "../utils/errors.js";
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

const INDEX_VERSION = 1;

// ---------------------------------------------------------------------------
// Embeddings store types
// ---------------------------------------------------------------------------

interface EmbeddingsStore {
  version: 1;
  model: string;
  dimensions: number;
  entries: Record<string, number[]>;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Id validation
// ---------------------------------------------------------------------------

/**
 * Allowed id shape: starts with an alphanumeric character, then any mix of
 * alphanumerics, `.`, `_` and `-`. No path separators, no leading dot (which
 * would collide with `.acp`, `.containers`, `.collections`), no whitespace.
 * Canonical ACP ids are UUID v7 and satisfy this trivially.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

/**
 * Validate that `id` can be safely used as a file name inside the vault.
 * Throws `ValidationError` otherwise. Exported for adapters that reuse the
 * same on-disk conventions.
 */
export function assertSafeId(id: string, label = "id"): void {
  if (typeof id !== "string" || !SAFE_ID.test(id) || id.includes("..")) {
    throw new ValidationError(
      `Invalid ${label} "${id}": ids may only contain letters, digits, ".", "_" and "-" and must not start with "."`
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NodeErrnoException extends Error {
  code?: string;
}

function isNodeError(err: unknown): err is NodeErrnoException {
  return err instanceof Error && "code" in err;
}

/** Read and parse a file as UTF-8. Returns `null` if the file does not exist. */
async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Write `data` to `filePath` atomically: write to a sibling temp file, then
 * rename over the target. Readers therefore see either the old or the new
 * content, never a partial file.
 */
async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data, "utf-8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Resolve `${dir}/${id}.md`, asserting the id is safe and the result stays inside `dir`. */
function documentPath(dir: string, id: string, label: string): string {
  assertSafeId(id, label);
  const resolved = path.resolve(dir, `${id}.md`);
  if (path.dirname(resolved) !== dir) {
    // Defence in depth — unreachable when SAFE_ID holds, but cheap to keep.
    throw new ValidationError(`Invalid ${label} "${id}": resolves outside the vault`);
  }
  return resolved;
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

function isVaultIndex(value: unknown): value is VaultIndex {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as VaultIndex).version === INDEX_VERSION &&
    typeof (value as VaultIndex).entries === "object" &&
    (value as VaultIndex).entries !== null
  );
}

function isEmbeddingsStore(value: unknown): value is EmbeddingsStore {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as EmbeddingsStore).version === 1 &&
    typeof (value as EmbeddingsStore).entries === "object" &&
    (value as EmbeddingsStore).entries !== null
  );
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.NaN;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
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
  private readonly embeddingsPath: string;

  /** Set to true after `ensureDirectories()` has run successfully. */
  private initialised = false;

  /**
   * Serialises every mutation of `.acp/*.json` (and the document write that
   * precedes it) so read-modify-write cycles never interleave.
   */
  private writeLock: Promise<void> = Promise.resolve();

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath);
    this.containersPath = path.join(this.vaultPath, ".containers");
    this.collectionsPath = path.join(this.vaultPath, ".collections");
    this.acpDir = path.join(this.vaultPath, ".acp");
    this.indexPath = path.join(this.acpDir, "index.json");
    this.embeddingsPath = path.join(this.acpDir, "embeddings.json");
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

  /** Run `fn` exclusively with respect to every other write on this adapter. */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeLock.then(fn, fn);
    // Keep the chain alive regardless of `fn`'s outcome.
    this.writeLock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  // -------------------------------------------------------------------------
  // Index helpers
  // -------------------------------------------------------------------------

  /**
   * Load the index from disk without taking the lock. A missing, corrupt or
   * incompatible index is rebuilt from the `.md` files (and persisted).
   */
  private async loadIndexUnlocked(): Promise<VaultIndex> {
    await this.ensureDirectories();
    const raw = await readFileSafe(this.indexPath);
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isVaultIndex(parsed)) return parsed;
      } catch {
        // fall through to rebuild
      }
    }
    return this.buildIndexFromDisk();
  }

  /** Read the index (rebuilding if necessary), serialised behind the lock. */
  private readIndex(): Promise<VaultIndex> {
    return this.withLock(() => this.loadIndexUnlocked());
  }

  /** Atomically apply `mutate` to the index and persist it. */
  private mutateIndex(mutate: (index: VaultIndex) => void): Promise<void> {
    return this.withLock(async () => {
      const index = await this.loadIndexUnlocked();
      mutate(index);
      await this.writeIndexUnlocked(index);
    });
  }

  private async writeIndexUnlocked(index: VaultIndex): Promise<void> {
    index.updated_at = new Date().toISOString();
    await writeFileAtomic(this.indexPath, JSON.stringify(index, null, 2));
  }

  private indexEntryFromACO(aco: ACO): IndexEntry {
    const fm = aco.frontmatter;
    return {
      title: String(fm["title"] ?? ""),
      source_type: String(fm["source_type"] ?? ""),
      created: String(fm["created"] ?? ""),
      tags: Array.isArray(fm["tags"]) ? (fm["tags"] as string[]) : [],
      // The spec treats a missing status as "draft"; index it that way so
      // `queryACOs({ status: ["draft"] })` matches unset documents.
      status: String(fm["status"] ?? "draft"),
      modified: fm["modified"] !== undefined ? String(fm["modified"]) : undefined,
    };
  }

  /** Scan every `.md` file in the vault root and persist a fresh index. */
  private async buildIndexFromDisk(): Promise<VaultIndex> {
    await this.ensureDirectories();
    const files = await fs.readdir(this.vaultPath);
    const index: VaultIndex = {
      version: 1,
      entries: {},
      updated_at: new Date().toISOString(),
    };

    for (const file of files) {
      if (!file.endsWith(".md") || file.startsWith(".")) continue;
      const raw = await readFileSafe(path.join(this.vaultPath, file));
      if (raw === null) continue;
      let result: ReturnType<typeof parseACO>;
      try {
        result = parseACO(raw);
      } catch {
        continue; // skip unparseable files rather than poison the index
      }
      const id = String(result.frontmatter["id"] ?? "");
      if (!id || !SAFE_ID.test(id)) continue;
      index.entries[id] = this.indexEntryFromACO(result);
    }

    await this.writeIndexUnlocked(index);
    return index;
  }

  /**
   * Rebuild `.acp/index.json` by scanning all ACO `.md` files in the vault root.
   *
   * This is a recovery / maintenance operation. Call it if the index gets out
   * of sync with the filesystem (e.g. after manual file edits).
   */
  async rebuildIndex(): Promise<void> {
    await this.withLock(() => this.buildIndexFromDisk());
  }

  // -------------------------------------------------------------------------
  // ACO CRUD
  // -------------------------------------------------------------------------

  async getACO(id: string): Promise<ACO | null> {
    await this.ensureDirectories();
    const filePath = documentPath(this.vaultPath, id, "ACO id");
    const raw = await readFileSafe(filePath);
    if (raw === null) return null;
    const result = parseACO(raw);
    return { frontmatter: result.frontmatter, body: result.body };
  }

  async putACO(aco: ACO): Promise<void> {
    await this.ensureDirectories();
    const id = String(aco.frontmatter["id"] ?? "");
    if (!id) throw new ValidationError("putACO: aco.frontmatter.id is required");

    const filePath = documentPath(this.vaultPath, id, "ACO id");
    const serialised = serializeACO(aco.frontmatter, aco.body);
    const entry = this.indexEntryFromACO(aco);

    await this.withLock(async () => {
      await writeFileAtomic(filePath, serialised);
      const index = await this.loadIndexUnlocked();
      index.entries[id] = entry;
      await this.writeIndexUnlocked(index);
    });
  }

  async deleteACO(id: string): Promise<void> {
    await this.ensureDirectories();
    const filePath = documentPath(this.vaultPath, id, "ACO id");

    await this.withLock(async () => {
      let existed = true;
      try {
        await fs.unlink(filePath);
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === "ENOENT") existed = false;
        else throw err;
      }

      const index = await this.loadIndexUnlocked();
      if (id in index.entries || existed) {
        delete index.entries[id];
        await this.writeIndexUnlocked(index);
      }

      const store = await this.loadEmbeddingsUnlocked();
      if (id in store.entries) {
        delete store.entries[id];
        await this.writeEmbeddingsUnlocked(store);
      }
    });
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
    const filePath = documentPath(this.containersPath, id, "container id");
    const raw = await readFileSafe(filePath);
    if (raw === null) return null;
    const result = parseACO(raw);
    return { frontmatter: result.frontmatter, body: result.body };
  }

  async putContainer(container: Container): Promise<void> {
    await this.ensureDirectories();
    const id = String(container.frontmatter["id"] ?? "");
    if (!id) throw new ValidationError("putContainer: container.frontmatter.id is required");

    const filePath = documentPath(this.containersPath, id, "container id");
    const serialised = serializeACO(container.frontmatter, container.body);
    await this.withLock(() => writeFileAtomic(filePath, serialised));
  }

  async listContainers(options?: ListOptions): Promise<Container[]> {
    await this.ensureDirectories();
    return applyListOptions(await this.readDocumentsIn(this.containersPath), options);
  }

  // -------------------------------------------------------------------------
  // Collection CRUD
  // -------------------------------------------------------------------------

  async getCollection(id: string): Promise<Collection | null> {
    await this.ensureDirectories();
    const filePath = documentPath(this.collectionsPath, id, "collection id");
    const raw = await readFileSafe(filePath);
    if (raw === null) return null;
    const result = parseACO(raw);
    return { frontmatter: result.frontmatter, body: result.body };
  }

  async putCollection(collection: Collection): Promise<void> {
    await this.ensureDirectories();
    const id = String(collection.frontmatter["id"] ?? "");
    if (!id) throw new ValidationError("putCollection: collection.frontmatter.id is required");

    const filePath = documentPath(this.collectionsPath, id, "collection id");
    const serialised = serializeACO(collection.frontmatter, collection.body);
    await this.withLock(() => writeFileAtomic(filePath, serialised));
  }

  async listCollections(options?: ListOptions): Promise<Collection[]> {
    await this.ensureDirectories();
    return applyListOptions(await this.readDocumentsIn(this.collectionsPath), options);
  }

  /** Read every `.md` document in `dir` (used for containers and collections). */
  private async readDocumentsIn(dir: string): Promise<Array<{ frontmatter: Record<string, unknown>; body: string }>> {
    const files = await fs.readdir(dir);
    const docs: Array<{ frontmatter: Record<string, unknown>; body: string }> = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const raw = await readFileSafe(path.join(dir, file));
      if (raw === null) continue;
      const result = parseACO(raw);
      docs.push({ frontmatter: result.frontmatter, body: result.body });
    }
    return docs;
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
  // Optional: vector embeddings
  // Brute-force cosine similarity over a flat JSON store in .acp/embeddings.json.
  // Suitable for vaults up to ~5,000 ACOs. Larger deployments should use a
  // database-backed adapter with pgvector or sqlite-vec.
  // -------------------------------------------------------------------------

  private async loadEmbeddingsUnlocked(): Promise<EmbeddingsStore> {
    await this.ensureDirectories();
    const empty: EmbeddingsStore = {
      version: 1,
      model: "",
      dimensions: 0,
      entries: {},
      updated_at: new Date().toISOString(),
    };
    const raw = await readFileSafe(this.embeddingsPath);
    if (raw === null) return empty;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isEmbeddingsStore(parsed) ? parsed : empty;
    } catch {
      return empty;
    }
  }

  private async writeEmbeddingsUnlocked(data: EmbeddingsStore): Promise<void> {
    data.updated_at = new Date().toISOString();
    await writeFileAtomic(this.embeddingsPath, JSON.stringify(data, null, 2));
  }

  async putEmbedding(id: string, vector: number[], model: string): Promise<void> {
    assertSafeId(id, "ACO id");
    if (!Array.isArray(vector) || vector.length === 0 || vector.some((v) => !Number.isFinite(v))) {
      throw new ValidationError("putEmbedding: vector must be a non-empty array of finite numbers");
    }

    await this.withLock(async () => {
      const store = await this.loadEmbeddingsUnlocked();

      if (store.model && store.model !== model) {
        console.warn(
          `[FilesystemAdapter] putEmbedding: model mismatch. ` +
            `Store contains "${store.model}" embeddings but received "${model}". ` +
            `Mixing embedding models will produce unreliable similarity results.`
        );
      }

      store.entries[id] = vector;
      store.model = model;
      store.dimensions = vector.length;

      await this.writeEmbeddingsUnlocked(store);
    });
  }

  async findSimilar(
    queryVector: number[],
    options?: SimilarityOptions
  ): Promise<SearchResult[]> {
    const { limit = 10, threshold = 0.7 } = options ?? {};

    const [store, index] = await this.withLock(async () => [
      await this.loadEmbeddingsUnlocked(),
      await this.loadIndexUnlocked(),
    ]);

    const scored: SearchResult[] = [];

    for (const [id, vector] of Object.entries(store.entries)) {
      const score = cosineSimilarity(queryVector, vector);
      // Dimension mismatches yield NaN; never let those through the filter.
      if (!Number.isFinite(score) || score < threshold) continue;

      const entry = index.entries[id];
      const frontmatter: Record<string, unknown> = entry
        ? {
            id,
            title: entry.title,
            source_type: entry.source_type,
            created: entry.created,
            tags: entry.tags,
            status: entry.status,
            ...(entry.modified !== undefined ? { modified: entry.modified } : {}),
          }
        : { id };

      scored.push({ id, score, frontmatter });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }
}
