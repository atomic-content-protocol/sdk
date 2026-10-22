import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Policy {
  name: string;
  legacy_name: string;
  limit: number;
  threshold: number;
  summary_k: number;
  max_bodies: number;
  cover_fraction: number;
  catalog_limit: number;
  instruction: string;
  sections: {
    catalog: string;
    ranking: string;
    opened: string;
    pages: string;
    search_index: string;
    search_ranking: string;
    search_pages: string;
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

export function loadPolicy(root = EXAMPLE_ROOT): Policy {
  const raw = JSON.parse(readFileSync(path.join(root, "policy.json"), "utf8")) as Policy;
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
