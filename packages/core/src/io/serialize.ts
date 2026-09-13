import matter from "gray-matter";
import { grayMatterOptions } from "./yaml-engine.js";

/**
 * serializeACO — combine a frontmatter object and a Markdown body into a
 * well-formed .md file string.
 *
 * Output format:
 * ```
 * ---
 * <yaml frontmatter>
 * ---
 * <body>
 * ```
 *
 * Uses the same js-yaml JSON_SCHEMA engine as parseACO so round-trips are
 * lossless. The file always ends with exactly one newline; `parseACO` strips
 * that one newline, so the body survives a parse → serialize → parse cycle
 * byte-for-byte (see parseACO for the one edge case).
 */
export function serializeACO(frontmatter: Record<string, unknown>, body: string): string {
  const out = matter.stringify(body, frontmatter, grayMatterOptions as Parameters<typeof matter.stringify>[2]);
  // gray-matter appends "\n" when the body lacks one and keeps existing
  // trailing newlines; normalise to exactly one.
  return out.replace(/\n*$/, "\n");
}
