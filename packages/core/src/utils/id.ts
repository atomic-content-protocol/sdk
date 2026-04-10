import { v7 as uuidv7 } from "uuid";

/**
 * generateId — returns a UUID v7 string.
 *
 * UUID v7 is time-sortable: the first 48 bits are a Unix millisecond
 * timestamp, making lexicographic sort equivalent to creation-time sort.
 * This property is relied on throughout ACP for deterministic ordering
 * of objects when no explicit `created` field is present.
 */
export function generateId(): string {
  return uuidv7();
}
