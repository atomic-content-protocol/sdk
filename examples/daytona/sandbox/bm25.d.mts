export const BM25_K1: number;
export const BM25_B: number;

export interface SearchPage {
  slug: string;
  title: string;
  url: string;
  body: string;
}

export interface Bm25Hit {
  slug: string;
  title: string;
  url: string;
  score: number;
}

export function bm25Search(
  pages: SearchPage[],
  queryText: string,
  stopwords: readonly string[],
  limit: number
): Bm25Hit[];

export function searchMaterial(
  pages: SearchPage[],
  hits: Bm25Hit[],
  sections: { search_index: string; search_ranking: string; search_pages: string }
): string;
