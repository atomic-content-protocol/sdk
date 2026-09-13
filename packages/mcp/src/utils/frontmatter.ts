/**
 * Small, dependency-free helpers for reading loosely-typed frontmatter.
 * Shared by the search and relationship tools.
 */

export function extractStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function extractEntityNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .map((v) => String(v["name"] ?? ""))
    .filter(Boolean);
}

/** Case-insensitive Jaccard similarity of two string lists. */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const A = new Set(a.map((s) => s.toLowerCase()));
  const B = new Set(b.map((s) => s.toLowerCase()));
  let intersection = 0;
  for (const s of A) if (B.has(s)) intersection++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Case-insensitive intersection, preserving the order of `a`. */
export function shared(a: string[], b: string[]): string[] {
  const B = new Set(b.map((s) => s.toLowerCase()));
  return a.filter((s) => B.has(s.toLowerCase()));
}

/** Lower-cased word tokens (length ≥ 3) for crude text overlap. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

export function titleOf(frontmatter: Record<string, unknown>): string | null {
  const t = frontmatter["title"];
  return typeof t === "string" ? t : null;
}

export function idOf(frontmatter: Record<string, unknown>): string {
  return String(frontmatter["id"] ?? "");
}

/**
 * Map raw cosine similarity to a calibrated [0, 1] relevance score.
 * Sentence-embedding models place unrelated text around 0.5–0.7, so raw
 * cosine over-reports; treat 0.5 as "no relation" and 1.0 as identical.
 */
export function calibrateCosine(cosine: number): number {
  return Math.max(0, Math.min(1, (cosine - 0.5) / 0.5));
}
