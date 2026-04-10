/**
 * Core runtime types for the Atomic Content Protocol (ACP).
 *
 * These interfaces represent parsed, in-memory representations of ACP objects.
 * They are distinct from the Zod schema validators: schemas validate structure,
 * these types carry the data through the SDK at runtime.
 *
 * When full Zod-backed ACOFrontmatter schemas are available, the `frontmatter`
 * field will be narrowed accordingly — for now it is typed as
 * `Record<string, unknown>` to remain forward-compatible.
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
  /** Structured metadata. Will be narrowed to ACOFrontmatter once schemas stabilise. */
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

/**
 * ACOParseResult — the return value of `parseACO`.
 *
 * `valid` is `true` when frontmatter passes schema validation.
 * `errors` is `null` when valid, or a list of structured error objects when not.
 */
export interface ACOParseResult {
  /** Parsed frontmatter (present even when `valid` is false). */
  frontmatter: Record<string, unknown>;
  /** Raw Markdown body. */
  body: string;
  /** Whether the frontmatter passed schema validation. */
  valid: boolean;
  /**
   * Structured validation errors, or `null` when the object is valid.
   * Each entry carries a dot-notation `path` and a human-readable `message`.
   */
  errors: Array<{ path: string; message: string }> | null;
}
