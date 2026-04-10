/**
 * IStorageAdapter — the pluggable persistence contract for ACP objects.
 *
 * Every concrete storage backend (filesystem, in-memory, remote API, …) must
 * implement this interface. Code that operates on ACOs should depend only on
 * this interface rather than on a concrete adapter so that backends can be
 * swapped freely (e.g. production vs. test vs. cloud).
 *
 * Convention:
 * - CRUD methods never throw on "not found" — they return `null`.
 * - Write methods (`put*`, `delete*`) return `void`; they throw on I/O errors.
 * - All IDs are UUID v7 strings.
 * - Optional methods (`putEmbedding`, `findSimilar`) may not be supported by
 *   all backends. Call sites must check for existence before calling.
 */

import type { ACO, Container, Collection } from "../types/aco.js";

// ---------------------------------------------------------------------------
// Query / filter helpers
// ---------------------------------------------------------------------------

/**
 * Pagination and sort options for `list*` methods.
 */
export interface ListOptions {
  /** Maximum number of objects to return. Defaults to implementation-defined limit. */
  limit?: number;
  /** Number of objects to skip before returning results (zero-based). */
  offset?: number;
  /** Field to sort by. Adapters should support at least `created`. */
  sortBy?: "created" | "modified" | "title";
  /** Sort direction. Defaults to `asc`. */
  order?: "asc" | "desc";
}

/**
 * Structured filter for `queryACOs`.
 *
 * All provided fields are combined with AND semantics.
 * Within array-valued fields (e.g. `tags`), the match is OR
 * (return ACOs that have *any* of the supplied tags).
 */
export interface ACOQuery {
  /** Return ACOs that carry at least one of the supplied tags. */
  tags?: string[];
  /** Filter by `source_type` values (OR). */
  source_type?: string[];
  /** Filter by `status` values (OR). */
  status?: string[];
  /** Filter by `visibility` values (OR). */
  visibility?: string[];
  /** Return ACOs created on or after this ISO 8601 timestamp. */
  created_after?: string;
  /** Return ACOs created strictly before this ISO 8601 timestamp. */
  created_before?: string;
  /** Full-text search string applied to title and/or body (adapter-defined). */
  search?: string;
}

/**
 * Options for `findSimilar` (vector-based nearest-neighbour search).
 */
export interface SimilarityOptions {
  /** Maximum number of results. Defaults to 10. */
  limit?: number;
  /** Minimum cosine similarity threshold (0.0–1.0). Results below this are excluded. */
  threshold?: number;
}

/**
 * A single result from `findSimilar`.
 */
export interface SearchResult {
  /** ACO / object ID. */
  id: string;
  /** Similarity score in [0, 1]. Higher is more similar. */
  score: number;
  /** Frontmatter of the matched object (no body, to keep payloads small). */
  frontmatter: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * IStorageAdapter — core storage contract.
 *
 * Implementations must be safe to call concurrently from a single Node.js
 * process; they are not required to support multi-process coordination.
 */
export interface IStorageAdapter {
  // ---- ACO CRUD -----------------------------------------------------------

  /**
   * Retrieve a single ACO by its UUID.
   * Returns `null` if no object with that ID exists.
   */
  getACO(id: string): Promise<ACO | null>;

  /**
   * Persist an ACO. Creates the object if it does not exist; overwrites it if
   * it does. The `id` is read from `aco.frontmatter.id`.
   */
  putACO(aco: ACO): Promise<void>;

  /**
   * Delete an ACO by its UUID. No-op if the object does not exist.
   */
  deleteACO(id: string): Promise<void>;

  /**
   * Return a paginated, sorted list of all ACOs in the store.
   */
  listACOs(options?: ListOptions): Promise<ACO[]>;

  /**
   * Return all ACOs that match the supplied filter criteria.
   * Returns an empty array — not an error — when no objects match.
   */
  queryACOs(query: ACOQuery): Promise<ACO[]>;

  // ---- Container CRUD -----------------------------------------------------

  /**
   * Retrieve a single Container by its UUID.
   * Returns `null` if not found.
   */
  getContainer(id: string): Promise<Container | null>;

  /**
   * Persist a Container. Upsert semantics (same as `putACO`).
   */
  putContainer(container: Container): Promise<void>;

  /**
   * Return a paginated, sorted list of all Containers.
   */
  listContainers(options?: ListOptions): Promise<Container[]>;

  // ---- Collection CRUD ----------------------------------------------------

  /**
   * Retrieve a single Collection by its UUID.
   * Returns `null` if not found.
   */
  getCollection(id: string): Promise<Collection | null>;

  /**
   * Persist a Collection. Upsert semantics.
   */
  putCollection(collection: Collection): Promise<void>;

  /**
   * Return a paginated, sorted list of all Collections.
   */
  listCollections(options?: ListOptions): Promise<Collection[]>;

  // ---- Relationship traversal ---------------------------------------------

  /**
   * Return all outbound relationship edges stored on the given ACO.
   *
   * Edge direction convention: all stored edges are outbound. This method
   * reads `frontmatter.relationships` from the source ACO.
   */
  getEdgesFrom(
    acoId: string
  ): Promise<Array<{ rel_type: string; target_id: string; confidence?: number }>>;

  /**
   * Return all inbound relationship edges that point TO the given ACO.
   *
   * Because edges are stored on the source object, finding inbound edges
   * requires scanning the index. Adapters may implement this as a full scan
   * or maintain a reverse index for performance.
   */
  getEdgesTo(
    acoId: string
  ): Promise<Array<{ rel_type: string; source_id: string; confidence?: number }>>;

  // ---- Optional: vector embeddings ----------------------------------------

  /**
   * Store a vector embedding for the given object ID.
   * `model` identifies the embedding model (e.g. `"text-embedding-3-small"`).
   *
   * This method is optional — adapters that do not support embeddings should
   * omit it entirely. Call sites must check `typeof adapter.putEmbedding === 'function'`
   * before calling.
   */
  putEmbedding?(id: string, vector: number[], model: string): Promise<void>;

  /**
   * Find objects whose stored embedding is similar to the supplied query vector.
   *
   * This method is optional. Same guard as `putEmbedding`.
   */
  findSimilar?(
    vector: number[],
    options?: SimilarityOptions
  ): Promise<SearchResult[]>;
}
