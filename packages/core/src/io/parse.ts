import matter from "gray-matter";
import type { ZodError } from "zod";

import { ACOFrontmatterSchema } from "../schema/aco.schema.js";
import type { ACOFrontmatter } from "../schema/aco.schema.js";
import { grayMatterOptions } from "./yaml-engine.js";

/**
 * ParseResult — the raw output of parseACO.
 *
 * `frontmatter` is untyped: it is whatever gray-matter extracted from the
 * YAML block. `body` is the Markdown content after the closing `---`.
 * `raw` is the original file content passed in, preserved for hashing or
 * diagnostic purposes.
 */
export interface ParseResult {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

/**
 * parseACO — split a raw .md file string into frontmatter and body.
 *
 * This function is intentionally dumb: it parses but does NOT validate.
 * Use parseAndValidateACO when you need type-safe, validated frontmatter.
 *
 * Gray-matter is lenient: if there is no YAML block it returns an empty
 * frontmatter object and the full content as the body. This mirrors how
 * Obsidian and most static-site generators behave.
 *
 * Body fidelity: `serializeACO` terminates the file with exactly one newline
 * (POSIX text-file convention). `parseACO` removes that single trailing
 * newline again, so `parseACO(serializeACO(fm, body)).body === body` for any
 * body that does not itself end in a newline. Interior whitespace is never
 * touched.
 */
export function parseACO(fileContent: string): ParseResult {
  const result = matter(fileContent, grayMatterOptions);
  const body = result.content.endsWith("\n") ? result.content.slice(0, -1) : result.content;
  return {
    frontmatter: result.data as Record<string, unknown>,
    body,
    raw: fileContent,
  };
}

/**
 * ValidatedParseResult — the output of parseAndValidateACO.
 *
 * A discriminated union on `valid`: when true, `frontmatter` is typed as
 * `ACOFrontmatter` and `errors` is null; when false, `frontmatter` is the raw
 * parsed record and `errors` holds the Zod error.
 */
export type ValidatedParseResult =
  | { valid: true; frontmatter: ACOFrontmatter; body: string; errors: null }
  | { valid: false; frontmatter: Record<string, unknown>; body: string; errors: ZodError[] };

/**
 * parseAndValidateACO — parse a raw .md file and validate its frontmatter.
 *
 * Runs parseACO then passes the frontmatter through the ACOFrontmatterSchema
 * Zod validator. Returns a discriminated result so callers can handle
 * validation failures without throwing.
 */
export function parseAndValidateACO(fileContent: string): ValidatedParseResult {
  const { frontmatter, body } = parseACO(fileContent);
  const parsed = ACOFrontmatterSchema.safeParse(frontmatter);

  if (parsed.success) {
    return { valid: true, frontmatter: parsed.data, body, errors: null };
  }
  return { valid: false, frontmatter, body, errors: [parsed.error] };
}
