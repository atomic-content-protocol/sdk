export const BM25_K1: number;
export const BM25_B: number;

export interface SearchPage {
  slug: string;
  title: string;
  url: string;
  body: string;
  summary?: string;
  tags?: string[];
}

export interface Bm25Hit {
  slug: string;
  title: string;
  url: string;
  score: number;
}

export function tokenize(text: string, stopwords: readonly string[] | Set<string>): string[];

export function bm25Search<T extends { slug: string; title: string; url: string }>(
  pages: T[],
  queryText: string,
  stopwords: readonly string[],
  limit: number,
  indexText?: (page: T) => string
): Bm25Hit[];

export function searchMaterial(
  pages: SearchPage[],
  hits: Bm25Hit[],
  sections: { search_index: string; search_ranking: string; search_pages: string }
): string;

export interface SummaryFirstV1Options {
  summaryK: number;
  maxBodies: number;
  coverFraction: number;
}

export interface SummaryFirstOptions {
  summaryK: number;
  maxBodies: number;
  closeScoreRatio: number;
  runnerUpCoverFraction: number;
}

export interface SummaryFirstResult {
  candidate_slugs: string[];
  opened_slugs: string[];
  decision: "answer" | "open";
  cover_need: number;
  summaryBlock: string;
  summaryMaterial: string;
  bodyMaterial: string;
}

export function summaryFirstV1(
  pages: SearchPage[],
  queryText: string,
  stopwords: readonly string[],
  options: SummaryFirstV1Options
): SummaryFirstResult;

export function summaryFirst(
  pages: SearchPage[],
  queryText: string,
  stopwords: readonly string[],
  options: SummaryFirstOptions
): SummaryFirstResult;
