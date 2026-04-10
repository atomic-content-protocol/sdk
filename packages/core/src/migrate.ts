/**
 * ACP schema migration utilities.
 *
 * As the ACP schema evolves, frontmatter from older protocol versions must be
 * upgraded before it can be validated against a newer schema. This module
 * provides the `migrate` function that transforms frontmatter from one
 * `acp_version` to another.
 *
 * Current support matrix:
 *   "0.2" → "0.2"  — no-op (identity). Establishes the migration pattern.
 *
 * Adding a new migration:
 *   1. Add a new case to the `MIGRATIONS` map (keyed by `"fromVersion→toVersion"`).
 *   2. The migration function receives the frontmatter and must return a new
 *      (or mutated) copy. Never mutate the input directly.
 *   3. Add a test in `migrate.test.ts`.
 *
 * Note: `acp_version` in the frontmatter is the PROTOCOL version (e.g. "0.2"),
 * distinct from the schema document version (e.g. v0.4). See CLAUDE.md §Core naming.
 */

import { MigrationError } from "./utils/errors.js";

// Re-export so callers can catch it without importing from utils directly.
export { MigrationError };

// ---------------------------------------------------------------------------
// Migration registry
// ---------------------------------------------------------------------------

type MigrationFn = (
  frontmatter: Record<string, unknown>
) => Record<string, unknown>;

/** Key format: `"<fromVersion>→<toVersion>"`. */
const MIGRATIONS: Map<string, MigrationFn> = new Map([
  [
    "0.2→0.2",
    // No-op: same version, nothing to transform.
    (fm) => ({ ...fm }),
  ],
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Migrate frontmatter from `fromVersion` to `toVersion`.
 *
 * Returns a shallow copy of the frontmatter (the original is never mutated).
 * For same-version migrations the returned object has the same structure as
 * the input.
 *
 * @throws {MigrationError} if no migration is registered for the version pair.
 */
export function migrate(
  frontmatter: Record<string, unknown>,
  fromVersion: string,
  toVersion: string
): Record<string, unknown> {
  const key = `${fromVersion}→${toVersion}`;
  const migrationFn = MIGRATIONS.get(key);

  if (!migrationFn) {
    throw new MigrationError(
      `No migration path from acp_version "${fromVersion}" to "${toVersion}". ` +
        `Register a migration in migrate.ts to add support.`
    );
  }

  return migrationFn(frontmatter);
}
