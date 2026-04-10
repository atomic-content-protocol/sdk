import { z } from "zod";
import { ProvenanceMapSchema } from "./provenance.schema.js";
import { RelationshipEdgeSchema } from "./edge.schema.js";

/**
 * AuthorSchema (local) — mirrors ACO author, kept local to avoid circular imports.
 * See §3.4. Additional subfields are permitted (passthrough).
 */
const AuthorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .passthrough();

/**
 * TokenCountsSchema (local) — per-tokenizer token counts (§3.6).
 * On a Container, this is the aggregate sum across all contained ACOs.
 */
const TokenCountsSchema = z
  .object({
    cl100k: z.number().int().nonnegative().optional(),
    claude: z.number().int().nonnegative().optional(),
    llama3: z.number().int().nonnegative().optional(),
    approximate: z.number().int().nonnegative().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// ContainerFrontmatterSchema
// ---------------------------------------------------------------------------

/**
 * ContainerFrontmatterSchema — YAML frontmatter for a Container object.
 *
 * A Container is an ordered list of ACO IDs. It can have tags, relationships,
 * and provenance just like an ACO, but does NOT have ACO-specific fields.
 *
 * Fields that do NOT apply to Containers (§4.2):
 *   source_type, source_url, source_file, source_context,
 *   content_hash, key_entities, classification, confidence, media
 *
 * Required fields: id, acp_version, object_type ("container"), created, author.
 * (source_type is NOT required — containers have no source_type.)
 *
 * Spec reference: §4
 */
export const ContainerFrontmatterSchema = z
  .object({
    // -----------------------------------------------------------------------
    // Identity (shared with ACO, §3.2 / §4)
    // -----------------------------------------------------------------------

    /** Globally unique identifier. UUID v7 recommended; UUID v4 accepted. */
    id: z.string().min(1),

    /** Protocol version this object conforms to (e.g. "0.2"). */
    acp_version: z.string().min(1),

    /** Object type discriminator. Always "container" for this schema. */
    object_type: z.literal("container"),

    /** Creation timestamp. UTC. ISO 8601 with timezone designator. */
    created: z.string(),

    /** Last modification timestamp. UTC. ISO 8601 with timezone designator. */
    modified: z.string().optional(),

    /** Identity that created this object. */
    author: AuthorSchema,

    // -----------------------------------------------------------------------
    // Content metadata
    // -----------------------------------------------------------------------

    /** Human-readable title for the container. */
    title: z.string().optional(),

    /**
     * Synthesized summary of contained ACOs.
     * May be auto-generated or human-written.
     */
    summary: z.string().optional(),

    // -----------------------------------------------------------------------
    // Classification (subset — no key_entities or classification field)
    // -----------------------------------------------------------------------

    /** Classification tags. Lowercase recommended. Max 20 for display. */
    tags: z.array(z.string().min(1)).max(20).optional(),

    // -----------------------------------------------------------------------
    // Container-specific fields (§4.2)
    // -----------------------------------------------------------------------

    /**
     * Ordered list of ACO `id` values. Order is meaningful (curation sequence).
     * Each element is a non-empty string ID.
     */
    objects: z.array(z.string().min(1)).optional(),

    /**
     * Aggregate token counts across all contained ACOs. See §3.6 for key definitions.
     * Computed as sum per tokenizer key. See §4.3 for rollup behavior.
     */
    token_counts: TokenCountsSchema.optional(),

    // -----------------------------------------------------------------------
    // Provenance (§3.13)
    // -----------------------------------------------------------------------

    /** Per-field provenance for auto-generated fields. Keys are field names. */
    provenance: ProvenanceMapSchema.optional(),

    // -----------------------------------------------------------------------
    // Relationships (§3.14)
    // -----------------------------------------------------------------------

    /** Typed outbound relationship edges. All edges are outbound. */
    relationships: z.array(RelationshipEdgeSchema).optional(),

    // -----------------------------------------------------------------------
    // Access (§3.15)
    // -----------------------------------------------------------------------

    /** Discovery visibility: "public" | "private" | "restricted". */
    visibility: z.enum(["public", "private", "restricted"]).optional(),

    /** Whether AI agents can access this object via agent transport protocols. */
    agent_accessible: z.boolean().optional(),

    /** License or rights identifier (informational in v0.2). */
    rights: z.string().optional(),

    /**
     * Expiration timestamp. If set, the container is ephemeral.
     * null or absent = permanent.
     */
    expiration: z.string().nullable().optional(),

    /** Object lifecycle status: "draft" | "final" | "archived". */
    status: z.enum(["draft", "final", "archived"]).optional(),
  })
  .passthrough();

export type ContainerFrontmatter = z.infer<typeof ContainerFrontmatterSchema>;
