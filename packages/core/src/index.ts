/**
 * @atomic-content-protocol/core — public package entry point.
 *
 * Re-exports the full public API of the ACP Core SDK:
 *
 *   - schema    — Zod validators for ACO, Container, Collection, edges, provenance
 *   - types     — Runtime TypeScript interfaces (ACO, Container, Collection, etc.)
 *   - io        — parseACO, parseAndValidateACO, serializeACO
 *   - storage   — IStorageAdapter, FilesystemAdapter
 *   - graph     — getRelatedACOs
 *   - utils     — generateId, computeContentHash, computeTokenCounts, error classes
 *   - migrate   — migrate function + MigrationError
 *
 * Plus two convenience functions:
 *   - createACO       — build a fully-initialised ACO with defaults applied
 *   - validateACO     — validate frontmatter against ACOFrontmatterSchema
 */

// ---------------------------------------------------------------------------
// Sub-module re-exports
// ---------------------------------------------------------------------------

// Schema (Zod validators + inferred TypeScript types)
export * from "./schema/index.js";

// Runtime interfaces
export * from "./types/index.js";

// File I/O
export * from "./io/index.js";

// Storage
export * from "./storage/index.js";

// Graph traversal
export * from "./graph/index.js";

// Utilities
// Note: `TokenCounts` is exported from schema (ACO frontmatter shape).
// The utils TokenCounts (token-count.ts) is aliased to avoid a name clash.
export { generateId } from "./utils/id.js";
export { normalizeBody, computeContentHash } from "./utils/hash.js";
export {
  approximateTokenCount,
  computeTokenCounts,
  type TokenCounts as UtilTokenCounts,
} from "./utils/token-count.js";
export {
  ACPError,
  ValidationError,
  StorageError,
  ParseError,
  FetchError,
  type FetchStatus,
} from "./utils/errors.js";
export { fetchBodyForUrl, type FetchBodyOptions } from "./utils/fetch-url.js";

// Migration
export { migrate, MigrationError } from "./migrate.js";

// ---------------------------------------------------------------------------
// Convenience imports (used by createACO / validateACO below)
// ---------------------------------------------------------------------------

import { generateId } from "./utils/id.js";
import { computeContentHash, normalizeBody } from "./utils/hash.js";
import { computeTokenCounts } from "./utils/token-count.js";
import { ACOFrontmatterSchema } from "./schema/aco.schema.js";
import type { ACO } from "./types/aco.js";
import { fetchBodyForUrl } from "./utils/fetch-url.js";
import { ValidationError, FetchError, type FetchStatus } from "./utils/errors.js";

// ---------------------------------------------------------------------------
// createACO
// ---------------------------------------------------------------------------

/**
 * Parameters accepted by `createACO`.
 *
 * All fields are optional except `author`, which is required by the spec (§3.4).
 * Any extra frontmatter fields can be passed via `frontmatter` and will be
 * merged in, with generated fields taking precedence over anything in
 * `frontmatter` that overlaps.
 */
export interface CreateACOParams {
  /** Human-readable title. */
  title?: string;
  /**
   * Markdown body content. Mutually exclusive with `url`.
   * If neither `body` nor `url` is provided, body defaults to an empty string.
   */
  body?: string;
  /**
   * URL to fetch body content from. Mutually exclusive with `body`.
   * The SDK handles SSRF guard, fetch, HTML extraction, and SPA fallback.
   * If the fetch fails, the ACO is still returned with a synthesised body and
   * `fetch_status: { ok: false, ... }` in the frontmatter so the caller knows.
   * When provided and `source_type` is omitted, defaults to `"link"`.
   */
  url?: string;
  /**
   * How the ACO was created.
   * Defaults to `"manual"` (or `"link"` when `url` is provided).
   */
  source_type?:
    | "link"
    | "uploaded_md"
    | "manual"
    | "converted_pdf"
    | "converted_doc"
    | "converted_video"
    | "selected_text"
    | "llm_capture";
  /**
   * Author identity. Required by spec §3.4.
   * `id` is the implementation-specific user/system identifier.
   * `name` is the human-readable display name.
   */
  author: { id: string; name: string };
  /**
   * Additional frontmatter fields to merge in.
   * Generated fields (`id`, `created`, `acp_version`, `object_type`,
   * `content_hash`, `token_counts`) always take precedence.
   */
  frontmatter?: Record<string, unknown>;
}

/**
 * createACO — construct a fully-initialised ACO with generated fields.
 *
 * Generated fields (always set, not overridable via `params.frontmatter`):
 *   - `id`            — UUID v7
 *   - `acp_version`   — "0.2"
 *   - `object_type`   — "aco"
 *   - `created`       — current UTC timestamp (ISO 8601)
 *   - `content_hash`  — SHA-256 of the normalised body
 *   - `token_counts`  — token count estimates (approximate always; cl100k if tiktoken installed)
 *
 * The returned object is a valid `ACO` but is NOT automatically persisted.
 * Pass it to `adapter.putACO()` to write it to storage.
 */
export async function createACO(params: CreateACOParams): Promise<ACO> {
  // Programmer error — mutually exclusive fields
  if (params.url !== undefined && params.body !== undefined) {
    throw new ValidationError(
      "`url` and `body` are mutually exclusive in CreateACOParams"
    );
  }

  // Capture before the async fetch so we can reference it in generatedFields
  // without re-reading params.url after the body may have been replaced.
  const hasUrl = params.url !== undefined;

  let body = params.body ?? "";
  let fetchStatus: FetchStatus | undefined;

  if (hasUrl) {
    try {
      body = await fetchBodyForUrl(params.url as string);
      fetchStatus = { ok: true };
    } catch (err: unknown) {
      if (err instanceof FetchError) {
        // Degrade gracefully: synthesise body from available metadata so
        // downstream enrichment still has signal to work with.
        body = [params.title, params.url].filter(Boolean).join(" — ");
        fetchStatus = {
          ok: false,
          networkCode: err.networkCode,
          permanent: err.permanent,
          message: err.message,
        };
      } else {
        // ValidationError (SSRF) and unexpected errors propagate as-is
        throw err;
      }
    }
  }

  const now = new Date().toISOString();

  const generatedFields: Record<string, unknown> = {
    id: generateId(),
    acp_version: "0.2",
    object_type: "aco",
    source_type: params.source_type ?? (hasUrl ? "link" : "manual"),
    created: now,
    author: params.author,
    content_hash: computeContentHash(normalizeBody(body)),
    token_counts: await computeTokenCounts(body),
    // fetch_status is SDK-generated — always wins over caller-supplied frontmatter.
    // Omitted entirely for body-only ACOs (no url provided).
    ...(fetchStatus !== undefined ? { fetch_status: fetchStatus } : {}),
  };

  if (params.title !== undefined) {
    generatedFields["title"] = params.title;
  }

  const callerFrontmatter: Record<string, unknown> = {
    ...(params.frontmatter ?? {}),
  };

  // Set source_url when url was provided and caller hasn't already set it.
  // Intentionally in callerFrontmatter (lower precedence) so callers can
  // override it via params.frontmatter if needed.
  if (hasUrl && callerFrontmatter["source_url"] === undefined) {
    callerFrontmatter["source_url"] = params.url;
  }

  const frontmatter: Record<string, unknown> = {
    // Caller-supplied extra fields go in first (lowest precedence)
    ...callerFrontmatter,
    // Generated / required fields always win
    ...generatedFields,
  };

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// validateACO
// ---------------------------------------------------------------------------

/**
 * Structured validation error returned by `validateACO`.
 */
export interface ValidationIssue {
  /** Dot-notation path to the invalid field (e.g. `"author.id"`, `"tags[0]"`). */
  path: string;
  /** Human-readable description of the validation failure. */
  message: string;
}

/**
 * validateACO — validate an ACO frontmatter record against the ACOFrontmatterSchema.
 *
 * This is a non-throwing alternative to parsing with schema validation.
 * Use it when you want to report errors to the user rather than crash.
 *
 * @param frontmatter  The raw frontmatter record to validate.
 * @returns            `{ valid: true, errors: null }` on success,
 *                     `{ valid: false, errors: [...] }` on failure.
 */
export function validateACO(
  frontmatter: Record<string, unknown>
): { valid: boolean; errors: ValidationIssue[] | null } {
  const result = ACOFrontmatterSchema.safeParse(frontmatter);

  if (result.success) {
    return { valid: true, errors: null };
  }

  const errors: ValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  return { valid: false, errors };
}
