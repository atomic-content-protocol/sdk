import { z } from "zod";
import { RelationshipEdgeSchema } from "./edge.schema.js";
import { ProvenanceMapSchema } from "./provenance.schema.js";

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
 * On a Collection, this is the aggregate sum across all contained Containers.
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
// CollectionFrontmatterSchema
// ---------------------------------------------------------------------------

/**
 * CollectionFrontmatterSchema — YAML frontmatter for a Collection object.
 *
 * A Collection is an ordered list of Container IDs. It sits at the top of the
 * three-level hierarchy: Collection → Container → ACO.
 *
 * Fields that do NOT apply to Collections (§5.2 / §4.2):
 *   source_type, source_url, source_file, source_context,
 *   content_hash, key_entities, classification, confidence, media,
 *   objects (Collections contain Containers, not ACOs directly)
 *
 * Required fields: id, acp_version, object_type ("collection"), created, author.
 *
 * Spec reference: §5
 */
export const CollectionFrontmatterSchema = z
  .object({
    // -----------------------------------------------------------------------
    // Identity (shared with ACO and Container, §3.2 / §5)
    // -----------------------------------------------------------------------

    /** Globally unique identifier. UUID v7 recommended; UUID v4 accepted. */
    id: z.string().min(1),

    /** Protocol version this object conforms to (e.g. "0.2"). */
    acp_version: z.string().min(1),

    /** Object type discriminator. Always "collection" for this schema. */
    object_type: z.literal("collection"),

    /** Creation timestamp. UTC. ISO 8601 with timezone designator. */
    created: z.string(),

    /** Last modification timestamp. UTC. ISO 8601 with timezone designator. */
    modified: z.string().optional(),

    /** Identity that created this object. */
    author: AuthorSchema,

    // -----------------------------------------------------------------------
    // Content metadata
    // -----------------------------------------------------------------------

    /** Human-readable title for the collection. */
    title: z.string().optional(),

    // -----------------------------------------------------------------------
    // Classification (subset — no key_entities or classification field)
    // -----------------------------------------------------------------------

    /** Classification tags. Lowercase recommended. Max 20 for display. */
    tags: z.array(z.string().min(1)).max(20).optional(),

    // -----------------------------------------------------------------------
    // Collection-specific fields (§5.2)
    // -----------------------------------------------------------------------

    /**
     * Ordered list of Container `id` values.
     * Collections contain Containers, not ACOs directly.
     */
    containers: z.array(z.string().min(1)).optional(),

    /**
     * Count of all ACOs across all Containers in this Collection.
     * Computed/cached value. Non-negative integer.
     */
    total_objects: z.number().int().nonnegative().optional(),

    /**
     * Aggregate token counts across all Containers. See §3.6 for key definitions.
     * Rollup of all container-level token_counts.
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
     * Expiration timestamp. If set, the collection is ephemeral.
     * null or absent = permanent.
     */
    expiration: z.string().nullable().optional(),

    /** Object lifecycle status: "draft" | "final" | "archived". */
    status: z.enum(["draft", "final", "archived"]).optional(),
  })
  .passthrough();

export type CollectionFrontmatter = z.infer<typeof CollectionFrontmatterSchema>;
