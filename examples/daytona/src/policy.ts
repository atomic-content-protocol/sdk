import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentQuery, type Policy, promptPrefix } from "./policy-logic.js";

export type { Policy, Question } from "./policy-logic.js";
export { contentQuery, promptPrefix };

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const EXAMPLE_ROOT = path.resolve(HERE, "..");

export function loadPolicy(root = EXAMPLE_ROOT): Policy {
  const raw = JSON.parse(readFileSync(path.join(root, "policy.json"), "utf8")) as Policy;
  return raw;
}
