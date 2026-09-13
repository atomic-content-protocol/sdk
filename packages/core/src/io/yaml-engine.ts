import yaml from "js-yaml";

/**
 * Shared gray-matter engine used by both `parseACO` and `serializeACO`.
 *
 * js-yaml with JSON_SCHEMA disables YAML 1.1 implicit typing beyond what JSON
 * has: unquoted timestamps stay strings (no Date promotion), `yes`/`no` stay
 * strings, and the same engine on both sides guarantees parse → serialize →
 * parse round-trips are lossless for every value type JSON can express.
 *
 * `lineWidth: -1` disables yaml.dump's default 80-character folding so long
 * URLs and summaries are never wrapped.
 */
export const yamlEngine = {
  parse: (str: string): Record<string, unknown> => {
    const value = yaml.load(str, { schema: yaml.JSON_SCHEMA });
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  },
  stringify: (obj: object): string =>
    yaml.dump(obj as Record<string, unknown>, { schema: yaml.JSON_SCHEMA, lineWidth: -1 }),
};

export const grayMatterOptions = { engines: { yaml: yamlEngine } };
