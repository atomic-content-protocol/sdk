/**
 * Core runtime types for the Atomic Content Protocol (ACP).
 *
 * These interfaces are the in-memory shape every storage adapter and pipeline
 * passes around: a loosely-typed frontmatter record plus the Markdown body.
 *
 * They are deliberately *not* the validated Zod types (`ACOFrontmatter`,
 * `ContainerFrontmatter`, …). Files on disk may be partial, legacy, or carry
 * extension fields, and the SDK must be able to read, index and repair them.
 * Use `validateACO()` / `parseAndValidateACO()` to obtain the narrow types.
 */

/**
 * ACO — Atomic Content Object.
 *
 * The fundamental unit of ACP. An ACO is a YAML-frontmatter + Markdown-body
 * document. The `frontmatter` record holds all structured metadata (id,
 * title, source_type, tags, relationships, etc.). The `body` is the
 * unprocessed Markdown content.
 */
export interface ACO {
  /** Structured metadata as read from disk. See `validateACO()` for the typed view. */
  frontmatter: Record<string, unknown>;
  /** Raw Markdown body of the object. */
  body: string;
}

/**
 * Container — an ACO that groups other ACOs.
 *
 * Containers are implemented as YAML-frontmatter + Markdown documents, the
 * same as ACOs, but they carry container-specific frontmatter fields (e.g.
 * `object_type: container`). The storage adapter persists them separately to
 * allow efficient listing.
 */
export interface Container {
  /** Structured metadata for the container object. */
  frontmatter: Record<string, unknown>;
  /** Raw Markdown body (table of contents, description, etc.). */
  body: string;
}

/**
 * Collection — a named, ordered set of Containers or ACOs.
 *
 * Collections represent the top-level organisational unit in ACP (e.g. a
 * knowledge base, a project workspace). Like containers, they share the
 * YAML-frontmatter + Markdown structure.
 */
export interface Collection {
  /** Structured metadata for the collection object. */
  frontmatter: Record<string, unknown>;
  /** Raw Markdown body. */
  body: string;
}
