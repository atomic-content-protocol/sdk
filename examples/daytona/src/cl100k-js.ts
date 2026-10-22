/**
 * Browser cl100k_base counter. js-tiktoken is a pure JS port of the same
 * encoding `tiktoken` uses in the Node bench. `src/check-web.ts` checks that
 * the two counts match on this corpus.
 */

import { Tiktoken } from "js-tiktoken/lite";
import cl100k from "js-tiktoken/ranks/cl100k_base";

let encoder: Tiktoken | undefined;

export function countCl100kJs(text: string): number {
  encoder ??= new Tiktoken(cl100k);
  return encoder.encode(text).length;
}
