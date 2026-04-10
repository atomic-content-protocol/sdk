import matter from "gray-matter";
import yaml from "js-yaml";

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
 * Uses the same js-yaml JSON_SCHEMA engine as parseACO to guarantee
 * parse → serialize → parse round-trips are lossless: values that were
 * strings on the way in remain strings on the way out (no Date promotion,
 * no boolean coercion, etc.).
 *
 * `lineWidth: -1` disables yaml.dump's default 80-character line folding so
 * long URLs and summaries are never wrapped.
 */
export function serializeACO(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  return matter.stringify(body, frontmatter, {
    engines: {
      yaml: {
        parse: (str: string) =>
          yaml.load(str, {
            schema: yaml.JSON_SCHEMA,
          }) as Record<string, unknown>,
        stringify: (obj: Record<string, unknown>) =>
          yaml.dump(obj, { schema: yaml.JSON_SCHEMA, lineWidth: -1 }),
      },
    },
  } as Parameters<typeof matter.stringify>[2]);
}
