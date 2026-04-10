// ---------------------------------------------------------------------------
// ACP Core Schema — public exports
// ---------------------------------------------------------------------------

// Provenance
export {
  ProvenanceRecordSchema,
  ProvenanceMapSchema,
} from "./provenance.schema.js";
export type { ProvenanceRecord, ProvenanceMap } from "./provenance.schema.js";

// Relationship edges
export {
  RelationshipEdgeSchema,
  CORE_REL_TYPES,
} from "./edge.schema.js";
export type { RelationshipEdge, CoreRelType } from "./edge.schema.js";

// ACO (Atomic Content Object)
export {
  ACOFrontmatterSchema,
  SOURCE_TYPES,
} from "./aco.schema.js";
export type {
  ACOFrontmatter,
  Author,
  ACOTokenCounts,
  KeyEntity,
  SourceContext,
  Media,
  SourceType,
} from "./aco.schema.js";

// Container
export { ContainerFrontmatterSchema } from "./container.schema.js";
export type { ContainerFrontmatter } from "./container.schema.js";

// Collection
export { CollectionFrontmatterSchema } from "./collection.schema.js";
export type { CollectionFrontmatter } from "./collection.schema.js";
