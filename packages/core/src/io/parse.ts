import matter from "gray-matter";
import yaml from "js-yaml";
import type { ZodError } from "zod";

// NOTE: aco.schema.ts is authored by a parallel agent and will be present
// at compile time. The import uses the .js extension for NodeNext resolution.
import { ACOFrontmatterSchema } from "../schema/aco.schema.js";
import type { ACOFrontmatter } from "../schema/aco.schema.js";

/**
 * grayMatterOptions — shared gray-matter engine configuration.
 *
 * Uses js-yaml with JSON_SCHEMA to suppress YAML's automatic type coercion.
 * Without this, YAML parsers eagerly convert "2026-02-23" to a Date object,
 * "true"/"false" to booleans, etc. ACP keeps all values as their serialized
 * string form so that round-trip fidelity is guaranteed.
 */
const grayMatterOptions = {
  engines: {
    yaml: {
      parse: (str: string) =>
        yaml.load(str, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>,
      stringify: (obj: object) =>
        yaml.dump(obj as Record<string, unknown>, {
          schema: yaml.JSON_SCHEMA,
          lineWidth: -1,
        }),
    },
  },
} satisfies Parameters<typeof matter>[1];

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
 */
export function parseACO(fileContent: string): ParseResult {
  const result = matter(fileContent, grayMatterOptions);
  return {
    frontmatter: result.data as Record<string, unknown>,
    body: result.content,
    raw: fileContent,
  };
}

/**
 * ValidatedParseResult — the output of parseAndValidateACO.
 *
 * When `valid` is true, `frontmatter` is fully typed as ACOFrontmatter and
 * `errors` is null. When `valid` is false, `frontmatter` is the raw parsed
 * data (may be partial/incomplete) and `errors` contains the Zod issues.
 */
export interface ValidatedParseResult {
  frontmatter: ACOFrontmatter | Record<string, unknown>;
  body: string;
  valid: boolean;
  errors: ZodError[] | null;
}

/**
 * parseAndValidateACO — parse a raw .md file and validate its frontmatter.
 *
 * Runs parseACO then passes the frontmatter through the ACOFrontmatterSchema
 * Zod validator. Returns a discriminated result so callers can handle
 * validation failures without throwing.
 *
 * On success:  `valid: true`,  `frontmatter` typed as ACOFrontmatter, `errors: null`
 * On failure:  `valid: false`, `frontmatter` as raw Record, `errors` populated
 */
export function parseAndValidateACO(fileContent: string): ValidatedParseResult {
  const { frontmatter, body } = parseACO(fileContent);

  const parsed = ACOFrontmatterSchema.safeParse(frontmatter);

  if (parsed.success) {
    return {
      frontmatter: parsed.data,
      body,
      valid: true,
      errors: null,
    };
  }

  return {
    frontmatter,
    body,
    valid: false,
    errors: [parsed.error],
  };
}
