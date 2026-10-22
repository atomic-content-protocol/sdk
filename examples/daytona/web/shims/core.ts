/**
 * Browser stand-in for the core package barrel.
 * The barrel loads the filesystem adapter (`node:fs`). The benchmark page
 * only needs the values the MCP tool modules and the enrichment prompt
 * builder import. Node `check-web.ts` still imports the real package.
 */

export { SOURCE_TYPES } from "../../../../packages/core/src/schema/aco.schema.js";
export {
  type ContentModality,
  MIN_BODY_LENGTH_FOR_ENRICHMENT,
} from "../../../../packages/core/src/utils/source-type.js";
export { approximateTokenCount } from "../../../../packages/core/src/utils/token-count.js";
