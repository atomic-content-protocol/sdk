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
 * Pass `modality` to steer the model toward media-appropriate values.
 */
export function buildClassificationPrompt(
  title: string,
  body: string,
  modality: "text" | "document" | "image" | "video" = "text"
): string {
  if (modality === "image") {
    return `Return the single word: image`;
  }
  if (modality === "video") {
    return `Return the single word: video`;
  }
  return `Classify this content into one of: reference, framework, memo, checklist, notes, transcript, snippet, code, tutorial, analysis, other. Return just the single word.

Title: ${truncate(title, 200)}
Content: ${truncate(body, 2_000)}

Classification:`;
}

// ---------------------------------------------------------------------------
// Unified prompt (single LLM call for all four fields)
// ---------------------------------------------------------------------------

/**
 * Build a prompt that requests all enrichment fields in a single call.
 * Body is truncated to 4 000 characters to balance coverage vs. cost.
 *
 * Pass `modality` so the prompt steers the model correctly for media ACOs.
 * For "image" and "video" with no body, the prompt instructs the model to
 * use the media-appropriate classification and skip language detection.
 */
export function buildUnifiedPrompt(
  title: string,
  body: string,
  modality: "text" | "document" | "image" | "video" = "text"
): string {
  if (modality === "image") {
    return `Extract structured enrichment data for an image file.

Title/filename: ${truncate(title, 200)}

Rules:
- classification MUST be "image"
- language MUST be null (images have no text language)
- tags: 3-7 keywords describing the image based on the filename/title
- summary: one sentence describing what kind of image this appears to be based on the filename
- key_entities: extract any named entities from the filename/title only`;
  }

  if (modality === "video") {
    const hasTranscript = body.trim().length >= 50;
    if (hasTranscript) {
      return `Extract structured enrichment data for a video with transcript.

Title: ${truncate(title, 200)}
Transcript:
${truncate(body, 4_000)}

Rules:
- classification MUST be "video"
- language: detect from the transcript text, return ISO 639-1 two-letter code
- tags, summary, key_entities: derive from the transcript content`;
    }
    return `Extract structured enrichment data for a video file.

Title/filename: ${truncate(title, 200)}

Rules:
- classification MUST be "video"
- language MUST be null (no transcript available)
- tags: 3-7 keywords based on the filename/title
- summary: one sentence describing what kind of video this appears to be based on the filename
- key_entities: extract any named entities from the filename/title only`;
  }

  return `Analyze the following content and extract structured enrichment data.

Title: ${truncate(title, 200)}
Content:
${truncate(body, 4_000)}

Extract:
1. Tags: 3-7 relevant keywords (lowercase, single words or hyphenated phrases)
2. Summary: exactly 2 sentences, max 500 characters, starting with the subject
3. Classification: one of reference, framework, memo, checklist, notes, transcript, snippet, code, tutorial, analysis, other
4. Key entities: named entities with type (person, organization, technology, concept, location, event), name, and confidence (0.0-1.0)
5. Language: detect the primary language of the content, return as ISO 639-1 two-letter code (en, de, ja, etc.)`;
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
          "image",
          "video",
          "audio",
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
        type: ["string", "null"],
        description: "ISO 639-1 two-letter language code, or null for media ACOs with no text body",
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
  language: string | null;
}
