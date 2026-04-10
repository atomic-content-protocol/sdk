import { z } from "zod";
import { ProvenanceMapSchema } from "./provenance.schema.js";
import { RelationshipEdgeSchema } from "./edge.schema.js";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * AuthorSchema — identity that created the ACO (§3.4).
 * Set at creation, immutable. Additional subfields are permitted (passthrough).
 */
const AuthorSchema = z
  .object({
    /** Unique identifier for the author. Format is implementation-specific. */
    id: z.string().min(1),
    /** Human-readable display name. */
    name: z.string().min(1),
  })
  .passthrough();

/**
 * TokenCountsSchema — per-tokenizer token counts (§3.6).
 *
 * All keys are optional; implementations populate what they can compute.
 * `approximate` SHOULD always be provided as a fallback.
 * Additional tokenizer keys are permitted (passthrough).
 */
const TokenCountsSchema = z
  .object({
    /** OpenAI cl100k_base tokenizer (GPT-4, GPT-4o). */
    cl100k: z.number().int().nonnegative().optional(),
    /** Anthropic Claude tokenizer (via SDK count_tokens()). */
    claude: z.number().int().nonnegative().optional(),
    /** Meta Llama 3/4 tokenizer (via HuggingFace AutoTokenizer). */
    llama3: z.number().int().nonnegative().optional(),
    /** Heuristic estimate (e.g. chars/4). For display purposes. */
    approximate: z.number().int().nonnegative().optional(),
  })
  .passthrough();

/**
 * KeyEntitySchema — a single structured named entity (§3.8).
 * `type` and `name` are required; `confidence` is omitted for human-asserted entities.
 */
const KeyEntitySchema = z
  .object({
    /**
     * Entity type. Suggested: "person", "organization", "technology",
     * "concept", "location", "event". Open set — not a closed enum.
     */
    type: z.string().min(1),
    /** Entity name as it appears or should be canonically referenced. */
    name: z.string().min(1),
    /**
     * Confidence score for auto-extracted entities (0.0–1.0).
     * Omit for human-asserted entities.
     * Inherits model identity from provenance.key_entities (see §3.8).
     */
    confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough();

/**
 * SourceContextSchema — LLM session provenance for llm_capture ACOs (§3.10).
 * `model` is required; all other subfields are optional.
 * Additional subfields are permitted (passthrough).
 */
const SourceContextSchema = z
  .object({
    /** Model identifier that generated the content (e.g. "claude-sonnet-4-6"). */
    model: z.string().min(1),
    /** Conversation thread identifier on the source platform. */
    thread_id: z.string().optional(),
    /** Session identifier, if different from thread. */
    session_id: z.string().optional(),
    /** When the content was generated in the conversation. ISO 8601. */
    timestamp: z.string().optional(),
    /** Source platform identifier (e.g. "claude.ai", "chatgpt", "cursor"). */
    platform: z.string().optional(),
  })
  .passthrough();

/**
 * MediaSchema — hosted non-text content associated with the ACO (§3.11).
 * Orthogonal to source_type — can appear on any ACO.
 * Required when source_type is "converted_video".
 */
const MediaSchema = z
  .object({
    /** URL of the hosted media file. */
    url: z.string().url(),
    /** MIME type of the media (e.g. "video/mp4", "image/png", "audio/mpeg"). */
    mime_type: z.string().min(1),
    /** File size in bytes. */
    size: z.number().int().nonnegative().optional(),
    /** Duration in seconds. Applicable to video and audio. */
    duration: z.number().int().nonnegative().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Source type enum (§3.3)
// ---------------------------------------------------------------------------

export const SOURCE_TYPES = [
  "link",
  "uploaded_md",
  "manual",
  "converted_pdf",
  "converted_doc",
  "converted_video",
  "selected_text",
  "llm_capture",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

// ---------------------------------------------------------------------------
// ACOFrontmatterSchema — the full ACO frontmatter (§3)
// ---------------------------------------------------------------------------

/**
 * ACOFrontmatterSchema — the complete YAML frontmatter for an Atomic Content Object.
 *
 * Design principles (§2):
 * - 6 required fields: id, acp_version, object_type, source_type, created, author.
 * - Everything else is optional.
 * - .passthrough() ensures forward compatibility: unknown fields are preserved.
 *
 * Spec reference: §3 (entire section)
 */
export const ACOFrontmatterSchema = z
  .object({
    // -----------------------------------------------------------------------
    // Identity (§3.2)
    // -----------------------------------------------------------------------

    /**
     * Globally unique identifier. UUID v7 recommended; UUID v4 accepted.
     * Immutable after creation.
     */
    id: z.string().min(1),

    /**
     * Protocol version this object conforms to.
     * Value is "0.2" for this spec. Semver-like string.
     */
    acp_version: z.string().min(1),

    /**
     * Object type discriminator. For ACOs, always "aco".
     * Immutable after creation.
     */
    object_type: z.literal("aco"),

    /**
     * How this ACO was created. See §3.3 for all values and companion requirements.
     * Immutable after creation.
     */
    source_type: z.enum(SOURCE_TYPES),

    /**
     * Creation timestamp. UTC. ISO 8601 with timezone designator.
     * Immutable after creation.
     */
    created: z.string(),

    /**
     * Last modification timestamp. UTC. ISO 8601 with timezone designator.
     * Updated on any field or content change.
     */
    modified: z.string().optional(),

    /**
     * Identity that created this object. Immutable after creation.
     * See §3.4 for subfields.
     */
    author: AuthorSchema,

    // -----------------------------------------------------------------------
    // Content metadata (§3.5, §3.6)
    // -----------------------------------------------------------------------

    /** Human-readable title. Max 500 characters recommended. */
    title: z.string().optional(),

    /**
     * Primary language of the content body. ISO 639-1 two-letter code.
     * Examples: "en", "de", "ja".
     */
    language: z.string().optional(),

    /**
     * SHA-256 hash of the content body (everything after the closing ---).
     * Format: "sha256:<hex>". Frontmatter is excluded from the hash.
     */
    content_hash: z
      .string()
      .regex(/^sha256:[0-9a-f]+$/i)
      .optional(),

    /**
     * Per-tokenizer token counts. See §3.6.
     * Computed on the content body only; frontmatter is excluded.
     */
    token_counts: TokenCountsSchema.optional(),

    // -----------------------------------------------------------------------
    // Classification (§3.7, §3.8)
    // -----------------------------------------------------------------------

    /**
     * Classification tags. Lowercase recommended.
     * No hard maximum; implementations SHOULD cap display at 20.
     */
    tags: z.array(z.string().min(1)).max(20).optional(),

    /**
     * Content type. Suggested values: "reference", "framework", "memo",
     * "checklist", "notes", "transcript", "snippet", "code", "tutorial",
     * "analysis", "other". NOT a closed enum — custom values are valid.
     */
    classification: z.string().optional(),

    /**
     * Extracted named entities. See §3.8 for subfields.
     * `confidence` per entity inherits model identity from provenance.key_entities.
     */
    key_entities: z.array(KeyEntitySchema).optional(),

    // -----------------------------------------------------------------------
    // Source provenance (§3.9, §3.10, §3.11)
    // -----------------------------------------------------------------------

    /**
     * Original URL. Required when source_type is "link".
     * Recommended for "selected_text".
     */
    source_url: z.string().url().optional(),

    /**
     * Original filename. Required when source_type is "converted_pdf" or "converted_doc".
     */
    source_file: z.string().optional(),

    /**
     * LLM session provenance. Required when source_type is "llm_capture".
     * See §3.10 for subfields.
     */
    source_context: SourceContextSchema.nullable().optional(),

    /**
     * Hosted non-text content associated with the ACO. See §3.11.
     * Required when source_type is "converted_video".
     * Orthogonal to source_type — can appear on any ACO.
     */
    media: MediaSchema.nullable().optional(),

    // -----------------------------------------------------------------------
    // Enrichment (§3.12, §3.13)
    // -----------------------------------------------------------------------

    /** Concise summary of the content body. Max 500 characters recommended. */
    summary: z.string().max(500).optional(),

    /**
     * Behavioral relevance signal (0.0–1.0).
     * Based on engagement patterns and usage signals (saves, shares, recency, etc.).
     * This is NOT model accuracy. See §3.12 for the full distinction.
     */
    confidence: z.number().min(0).max(1).optional(),

    /**
     * Per-field provenance for auto-generated fields. See §3.13.
     * Keys are field names on this ACO. Presence of a key signals machine-generation.
     */
    provenance: ProvenanceMapSchema.optional(),

    // -----------------------------------------------------------------------
    // Relationships (§3.14)
    // -----------------------------------------------------------------------

    /**
     * Typed outbound relationship edges. See §3.14.
     * All stored edges are outbound (this object → target).
     */
    relationships: z.array(RelationshipEdgeSchema).optional(),

    // -----------------------------------------------------------------------
    // Access (§3.15)
    // -----------------------------------------------------------------------

    /**
     * Discovery visibility.
     * "public" — discoverable by anyone.
     * "private" — visible only to owner (default).
     * "restricted" — visible to specific users/groups per implementation.
     */
    visibility: z.enum(["public", "private", "restricted"]).optional(),

    /**
     * Whether AI agents can access this object via agent transport protocols (e.g. MCP).
     * Independent of visibility. Default: false.
     */
    agent_accessible: z.boolean().optional(),

    /**
     * License or rights identifier.
     * Recommended: SPDX identifiers (e.g. "CC-BY-4.0", "CC0-1.0", "proprietary").
     * Free-text also accepted. Informational in v0.2.
     */
    rights: z.string().optional(),

    /**
     * Expiration timestamp (ISO 8601). If set, the object is ephemeral.
     * null or absent = permanent. See §3.16 for deletion semantics.
     */
    expiration: z.string().nullable().optional(),

    /**
     * Object lifecycle status.
     * "draft" — work in progress (default).
     * "final" — published/locked.
     * "archived" — no longer active.
     */
    status: z.enum(["draft", "final", "archived"]).optional(),
  })
  .passthrough();

export type ACOFrontmatter = z.infer<typeof ACOFrontmatterSchema>;

// Re-export sub-schema types for consumers that need them individually
export type Author = z.infer<typeof AuthorSchema>;
/** ACOTokenCounts — inferred type from TokenCountsSchema. Aliased to avoid collision with utils TokenCounts. */
export type ACOTokenCounts = z.infer<typeof TokenCountsSchema>;
export type KeyEntity = z.infer<typeof KeyEntitySchema>;
export type SourceContext = z.infer<typeof SourceContextSchema>;
export type Media = z.infer<typeof MediaSchema>;
