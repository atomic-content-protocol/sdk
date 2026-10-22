/**
 * Okapi BM25 over raw page text. Shared by the offline measurement and the
 * sandbox agent so both open the same pages.
 *
 * k1 = 1.2, b = 0.75. IDF is the Lucene form
 * log(1 + (N - df + 0.5) / (df + 0.5)).
 * Tokens are lowercase runs of [a-z0-9] of length 3 or more, minus the
 * stopword list in policy.json. The query uses each remaining term once.
 * The indexed text is the title plus the body. Ties break by slug ascending.
 * A hit with score 0 is dropped, then the list is cut to `limit`.
 */

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export function tokenize(text, stopwords) {
  const stop = stopwords instanceof Set ? stopwords : new Set(stopwords);
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !stop.has(word));
}

export function bm25Search(pages, queryText, stopwords, limit) {
  const terms = [...new Set(tokenize(queryText, stopwords))];
  const docs = pages.map((page) => {
    const tokens = tokenize(`${page.title}\n${page.body}`, stopwords);
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    return { page, tf, length: tokens.length };
  });
  const n = docs.length;
  const avgdl = n === 0 ? 0 : docs.reduce((sum, doc) => sum + doc.length, 0) / n;
  const df = new Map();
  for (const term of terms) {
    let count = 0;
    for (const doc of docs) if (doc.tf.has(term)) count += 1;
    df.set(term, count);
  }
  const scored = docs.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const freq = doc.tf.get(term) ?? 0;
      if (freq === 0) continue;
      const documentFrequency = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - documentFrequency + 0.5) / (documentFrequency + 0.5));
      const denom = freq + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / (avgdl || 1));
      score += idf * ((freq * (BM25_K1 + 1)) / denom);
    }
    return { slug: doc.page.slug, title: doc.page.title, url: doc.page.url, score };
  });
  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return scored.filter((row) => row.score > 0).slice(0, limit);
}

export function searchMaterial(pages, hits, sections) {
  const index = pages
    .map((page) => ({ slug: page.slug, title: page.title, url: page.url }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
  const ranking = hits.map((hit, indexPosition) => ({
    rank: indexPosition + 1,
    slug: hit.slug,
    title: hit.title,
    url: hit.url,
    score: hit.score.toFixed(6),
  }));
  const opened = hits
    .map((hit) => {
      const page = pages.find((candidate) => candidate.slug === hit.slug);
      if (!page) throw new Error(`BM25 hit missing page ${hit.slug}`);
      return `# ${page.title}\n${page.url}\n\n${page.body}`;
    })
    .join("\n\n");
  return `${sections.search_index}${JSON.stringify(index, null, 2)}\n\n${sections.search_ranking}${JSON.stringify(ranking, null, 2)}\n\n${sections.search_pages}${opened}`;
}
