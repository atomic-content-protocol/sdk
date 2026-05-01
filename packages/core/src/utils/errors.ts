/**
 * ACPError — base error class for all errors thrown by the ACP SDK.
 *
 * Every error carries a `code` string that callers can switch on without
 * relying on `instanceof` chains or string-matching `message`.
 */
export class ACPError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ACPError";
    this.code = code;

    // Maintain a clean stack trace in V8 environments.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/**
 * ValidationError — thrown when an ACO or schema value fails Zod validation.
 *
 * Typical causes: missing required fields, wrong field types, enum violations.
 */
export class ValidationError extends ACPError {
  constructor(message: string, options?: ErrorOptions) {
    super("VALIDATION_ERROR", message, options);
    this.name = "ValidationError";
  }
}

/**
 * StorageError — thrown when a read, write, or delete operation on the
 * underlying storage layer fails (filesystem, database, object store, etc.).
 */
export class StorageError extends ACPError {
  constructor(message: string, options?: ErrorOptions) {
    super("STORAGE_ERROR", message, options);
    this.name = "StorageError";
  }
}

/**
 * ParseError — thrown when the raw file content cannot be parsed into
 * frontmatter + body (e.g. malformed YAML, missing `---` delimiter).
 */
export class ParseError extends ACPError {
  constructor(message: string, options?: ErrorOptions) {
    super("PARSE_ERROR", message, options);
    this.name = "ParseError";
  }
}

/**
 * MigrationError — thrown when a schema migration cannot be applied,
 * for example because the source version is unknown or a required
 * field transformation fails.
 */
export class MigrationError extends ACPError {
  constructor(message: string, options?: ErrorOptions) {
    super("MIGRATION_ERROR", message, options);
    this.name = "MigrationError";
  }
}

/**
 * FetchError — thrown when fetching a URL fails at the network or HTTP layer.
 *
 * `permanent: true`  — do not retry (e.g. host not found, HTTP 4xx).
 * `permanent: false` — transient failure, caller may retry (e.g. HTTP 5xx, timeout, ECONNRESET).
 * `networkCode`      — machine-readable error origin: Node errno ("ENOTFOUND", "ETIMEDOUT")
 *                      or HTTP status string ("HTTP_404", "HTTP_503").
 */
export class FetchError extends ACPError {
  readonly permanent: boolean;
  readonly networkCode?: string;

  constructor(
    message: string,
    permanent: boolean,
    networkCode?: string,
    options?: ErrorOptions
  ) {
    super("FETCH_ERROR", message, options);
    this.name = "FetchError";
    this.permanent = permanent;
    this.networkCode = networkCode;
  }
}

/**
 * FetchStatus — recorded in an ACO's frontmatter under `fetch_status` when
 * `createACO` is called with a `url` parameter.
 *
 * `ok: true`  — fetch succeeded (field present for observability).
 * `ok: false` — fetch failed; body was synthesised from available metadata.
 *               `permanent` indicates whether retrying is worthwhile.
 *               `networkCode` carries the machine-readable failure reason.
 */
export interface FetchStatus {
  ok: boolean;
  networkCode?: string;
  permanent?: boolean;
  message?: string;
}
