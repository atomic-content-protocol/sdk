// ---------------------------------------------------------------------------
// ACP Core Schema — public exports
// ---------------------------------------------------------------------------

export type {
  ACOEnvelope,
  ACOFrontmatter,
  ACOTokenCounts,
  Author,
  KeyEntity,
  Media,
  SourceContext,
  SourceType,
} from "./aco.schema.js";
// ACO (Atomic Content Object)
export {
  ACOEnvelopeSchema,
  ACOFrontmatterSchema,
  SOURCE_TYPES,
} from "./aco.schema.js";
export type { CollectionFrontmatter } from "./collection.schema.js";
// Collection
export { CollectionFrontmatterSchema } from "./collection.schema.js";
// Shared fragments
export { AuthorSchema, TokenCountsSchema } from "./common.schema.js";
export type { ContainerFrontmatter } from "./container.schema.js";
// Container
export { ContainerFrontmatterSchema } from "./container.schema.js";
export type { CoreRelType, RelationshipEdge } from "./edge.schema.js";
// Relationship edges
export {
  CORE_REL_TYPES,
  RelationshipEdgeSchema,
} from "./edge.schema.js";
export type { ProvenanceMap, ProvenanceRecord } from "./provenance.schema.js";
// Provenance
export {
  ProvenanceMapSchema,
  ProvenanceRecordSchema,
} from "./provenance.schema.js";
