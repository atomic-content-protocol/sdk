/**
 * Cosine similarity between two numeric vectors.
 *
 * Returns a value in [-1, 1] where 1 means identical direction.
 * Throws if vectors have different lengths or are zero-length.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vectors must have same length (got ${a.length} vs ${b.length})`);
  }
  if (a.length === 0) {
    throw new Error("Vectors must not be empty");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0; // One or both vectors are all-zeros
  return dot / denom;
}
