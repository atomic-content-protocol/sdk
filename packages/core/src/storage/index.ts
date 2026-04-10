/**
 * ACP Core — storage sub-module exports.
 *
 * Exposes the adapter interface (types) and the built-in filesystem adapter.
 * Additional adapters (in-memory, SQLite, cloud) can be added here as they
 * are implemented.
 */
export type {
  IStorageAdapter,
  ListOptions,
  ACOQuery,
  SimilarityOptions,
  SearchResult,
} from "./adapter.interface.js";

export { FilesystemAdapter } from "./filesystem.adapter.js";
