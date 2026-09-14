import { ValidationError } from "../utils/errors.js";
import { yamlEngine } from "./yaml-engine.js";

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
 * The file is assembled by hand rather than via `gray-matter.stringify`,
 * which first *parses* the body as a frontmatter document: a body beginning
 * with `---` could inject keys into the saved frontmatter or lose its first
 * paragraph. Here the body is written verbatim.
 *
 * Uses the same js-yaml JSON_SCHEMA engine as parseACO so round-trips are
 * lossless. The file always ends with exactly one newline; `parseACO` strips
 * that one newline, so the body survives a parse → serialize → parse cycle
 * byte-for-byte.
 */
export function serializeACO(frontmatter: Record<string, unknown>, body: string): string {
  let yaml: string;
  try {
    yaml = yamlEngine.stringify(frontmatter);
  } catch (err) {
    throw new ValidationError(
      `Frontmatter cannot be serialised as YAML (only JSON-compatible values are allowed): ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  }
  // yaml.dump of an empty object yields "{}\n"; write an empty block instead.
  const block = yaml.trim() === "{}" ? "" : yaml.endsWith("\n") ? yaml : `${yaml}\n`;
  const trimmed = body.replace(/\n*$/, "");
  return trimmed ? `---\n${block}---\n${trimmed}\n` : `---\n${block}---\n`;
}
