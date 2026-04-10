import { z } from "zod";
import { ProvenanceRecordSchema } from "./provenance.schema.js";

/**
 * Core relationship types defined by the ACP spec (§3.14).
 * Extension types use the "x-" prefix convention.
 */
export const CORE_REL_TYPES = [
  "references",
  "derived-from",
  "supersedes",
  "supports",
  "contradicts",
  "part-of",
  "related",
] as const;

export type CoreRelType = (typeof CORE_REL_TYPES)[number];

/**
 * RelationshipEdgeSchema — a single typed edge in the `relationships` array.
 *
 * Spec reference: §3.14
 *
 * All stored edges are OUTBOUND (this object → target).
 * `target_id` is a UUID for ACP objects, or a URL for external references.
 * Extension types MUST use the "x-" prefix.
 */
export const RelationshipEdgeSchema = z
  .object({
    /**
     * Relationship type. Core types are enumerated above.
     * Extension types must start with "x-" (e.g. "x-cites", "x-inspired-by").
     */
    rel_type: z
      .string()
      .refine(
        (v) =>
          (CORE_REL_TYPES as readonly string[]).includes(v) ||
          v.startsWith("x-"),
        {
          message:
            'rel_type must be a core type (references, derived-from, supersedes, supports, contradicts, part-of, related) or start with "x-" for extensions.',
        }
      ),
    /**
     * ID of the related object. UUID for ACP objects; URL for external references.
     */
    target_id: z.string().min(1),
    /**
     * Confidence score for auto-inferred edges (0.0–1.0).
     * Omit for human-asserted relationships.
     */
    confidence: z.number().min(0).max(1).optional(),
    /**
     * Which model/process created this edge. Same structure as §3.13 provenance records.
     * Omit for human-asserted relationships.
     */
    provenance: ProvenanceRecordSchema.optional(),
  })
  .passthrough();

export type RelationshipEdge = z.infer<typeof RelationshipEdgeSchema>;
