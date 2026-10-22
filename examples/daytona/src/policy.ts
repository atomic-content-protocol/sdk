import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Policy {
  name: string;
  limit: number;
  threshold: number;
  instruction: string;
  sections: {
    catalog: string;
    ranking: string;
    opened: string;
    pages: string;
  };
  stopwords: string[];
  fork_sizes: number[];
}

export interface Question {
  id: string;
  question: string;
  expected_answer: string;
  gold_slugs: string[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const EXAMPLE_ROOT = path.resolve(HERE, "..");

export function loadPolicy(): Policy {
  const raw = JSON.parse(readFileSync(path.join(EXAMPLE_ROOT, "policy.json"), "utf8")) as Policy;
  return raw;
}

/**
 * Content words passed to `find_similar`.
 * The MCP overlap tokenizer keeps every token of length 3 or more, so function
 * words would dominate the union. Dropping this fixed stopword list is the
 * documented query the benchmark sends. The scorer itself is unchanged.
 */
export function contentQuery(question: string, stopwords: readonly string[]): string {
  const stop = new Set(stopwords);
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !stop.has(word))
    .join(" ");
}

export function promptPrefix(policy: Policy, question: string): string {
  return `${policy.instruction}Question: ${question}\n\n`;
}
