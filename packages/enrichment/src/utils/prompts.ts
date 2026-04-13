/**
 * Prompt builders for each enrichment pipeline.
 *
 * Centralising prompts here keeps them easy to review, test, and iterate
 * without touching pipeline logic.
 */

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) + "…" : s;

// ---------------------------------------------------------------------------
// Individual field prompts
// ---------------------------------------------------------------------------

/**
 * Build a prompt that asks the model to extract 3-7 tags/keywords.
 * Body is truncated to 2 000 characters to stay within token budgets.
 */
export function buildTagPrompt(title: string, body: string): string {
  return `Extract 3-7 relevant tags/keywords for this content. Tags should be lowercase, single words or hyphenated phrases. Focus on topics, concepts, and technologies mentioned.

Title: ${truncate(title, 200)}
Content: ${truncate(body, 2_000)}

Return as JSON: ["tag1", "tag2", ...]

Tags:`;
}

/**
 * Build a prompt that produces a 2-sentence summary (max 500 characters).
 * Body is truncated to 4 000 characters.
 */
export function buildSummaryPrompt(title: string, body: string): string {
  return `Title: ${truncate(title, 200)}

Content:
${truncate(body, 4_000)}

Generate a concise summary in exactly 2 sentences, max 500 characters. Start with the subject. Do not add filler or meta-commentary.`;
}

/**
 * Build a prompt that extracts named entities with type and confidence.
 * Body is truncated to 3 000 characters.
 */
export function buildEntityPrompt(title: string, body: string): string {
  return `Extract named entities from this content. For each entity provide: type (person, organization, technology, concept, location, event), name, and confidence (0.0-1.0).

Title: ${truncate(title, 200)}
Content: ${truncate(body, 3_000)}

Return as JSON array: [{"type": "...", "name": "...", "confidence": 0.9}, ...]`;
}

/**
 * Build a prompt that classifies content into a fixed taxonomy.
 */
export function buildClassificationPrompt(title: string, body: string): string {
  return `Classify this content into one of: reference, framework, memo, checklist, notes, transcript, snippet, code, tutorial, analysis, other. Return just the single word.

Title: ${truncate(title, 200)}
Content: ${truncate(body, 2_000)}

Classification:`;
}

// ---------------------------------------------------------------------------
// Unified prompt (single LLM call for all four fields)
// ---------------------------------------------------------------------------

/**
 * Build a prompt that requests all four enrichment fields in a single call.
 * Body is truncated to 4 000 characters to balance coverage vs. cost.
 *
 * This is intended for use with `provider.structuredComplete()` — the schema
 * enforces the shape of the response.
 */
export function buildUnifiedPrompt(title: string, body: string): string {
  return `Analyze the following content and extract structured enrichment data.

Title: ${truncate(title, 200)}
Content:
${truncate(body, 4_000)}

Extract:
1. Tags: 3-7 relevant keywords (lowercase, single words or hyphenated phrases)
2. Summary: exactly 2 sentences, max 500 characters, starting with the subject
3. Classification: one of reference, framework, memo, checklist, notes, transcript, snippet, code, tutorial, analysis, other
4. Key entities: named entities with type (person, organization, technology, concept, location, event), name, and confidence (0.0-1.0)
5. Language: Detect the primary language of the content. Return as ISO 639-1 two-letter code (en, de, ja, etc.)`;
}

// ---------------------------------------------------------------------------
// Unified schema (for structuredComplete)
// ---------------------------------------------------------------------------

/**
 * JSON-Schema-compatible schema for unified enrichment output.
 * Pass this to `provider.structuredComplete<UnifiedEnrichmentOutput>()`.
 */
export const UNIFIED_SCHEMA = {
  name: "enrich_aco",
  description:
    "Extract tags, summary, classification, and key entities from content",
  parameters: {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "3-7 relevant tags/keywords (lowercase, single words or hyphenated phrases)",
      },
      summary: {
        type: "string",
        description:
          "Exactly 2 sentences, max 500 characters, starting with the subject",
      },
      classification: {
        type: "string",
        enum: [
          "reference",
          "framework",
          "memo",
          "checklist",
          "notes",
          "transcript",
          "snippet",
          "code",
          "tutorial",
          "analysis",
          "other",
        ],
        description: "Content type classification",
      },
      key_entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "person",
                "organization",
                "technology",
                "concept",
                "location",
                "event",
              ],
            },
            name: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["type", "name", "confidence"],
        },
        description: "Named entities found in the content",
      },
      language: {
        type: "string",
        description: "ISO 639-1 two-letter language code",
      },
    },
    required: ["tags", "summary", "classification", "key_entities", "language"],
  },
} as const;

/** TypeScript type for the structured output returned by the unified prompt. */
export interface UnifiedEnrichmentOutput {
  tags: string[];
  summary: string;
  classification: string;
  key_entities: Array<{
    type: string;
    name: string;
    confidence: number;
  }>;
  language: string;
}
