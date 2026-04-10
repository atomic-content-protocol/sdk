import { createHash } from "node:crypto";

/**
 * normalizeBody — canonicalize a Markdown body string before hashing.
 *
 * Normalization steps (applied in order):
 *  1. Replace CRLF (`\r\n`) with LF (`\n`) — Windows line endings
 *  2. Replace remaining CR (`\r`) with LF (`\n`) — old Mac OS 9 line endings
 *  3. Trim leading and trailing whitespace
 *  4. NFC Unicode normalization — ensures equivalent code-point sequences
 *     hash identically regardless of how they were composed.
 *
 * These steps guarantee that two semantically identical files produced on
 * different platforms will produce the same hash.
 */
export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .normalize("NFC");
}

/**
 * computeContentHash — returns a SHA-256 digest of the normalized body.
 *
 * The digest is prefixed with `"sha256:"` so the algorithm is self-describing
 * in the ACO `content_hash` field (spec §3.6).
 *
 * Example return value: `"sha256:a1b2c3d4e5f6..."`
 */
export function computeContentHash(body: string): string {
  const normalized = normalizeBody(body);
  const hex = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `sha256:${hex}`;
}
