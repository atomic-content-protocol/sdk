/**
 * Okapi BM25 over raw page text. Shared by the offline measurement and the
 * sandbox agent so both open the same pages.
 *
 * k1 = 1.2, b = 0.75. IDF is the Lucene form
 * log(1 + (N - df + 0.5) / (df + 0.5)).
 * Tokens are lowercase runs of [a-z0-9] of length 3 or more, minus the
 * stopword list in policy.json. The query uses each remaining term once.
 * The default indexed text is the title plus the body. Pass `indexText` to
 * rank a different string (summary-first uses title, summary, and tags).
 * Ties break by slug ascending. A hit with score 0 is dropped, then the
 * list is cut to `limit`.
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

export function bm25Search(pages, queryText, stopwords, limit, indexText) {
  const textOf = indexText ?? ((page) => `${page.title}\n${page.body}`);
  const terms = [...new Set(tokenize(queryText, stopwords))];
  const docs = pages.map((page) => {
    const tokens = tokenize(textOf(page), stopwords);
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

function summaryHits(pages, queryText, stopwords, summaryK) {
  const hits = bm25Search(pages, queryText, stopwords, summaryK, (page) =>
    `${page.title}\n${page.summary ?? ""}\n${(page.tags ?? []).join(" ")}`
  );
  const terms = [...new Set(tokenize(queryText, stopwords))];
  const judged = hits.map((hit) => {
    const page = pages.find((candidate) => candidate.slug === hit.slug);
    if (!page) throw new Error(`summary-first hit missing page ${hit.slug}`);
    const hay = new Set(tokenize(`${page.title}\n${page.summary ?? ""}\n${(page.tags ?? []).join(" ")}`, stopwords));
    const covered = terms.filter((term) => hay.has(term)).length;
    return { hit, page, covered };
  });
  const summaryBlock = judged
    .map(
      (row, index) =>
        `${index + 1}. slug: ${row.page.slug}\ntitle: ${row.page.title}\nsummary: ${row.page.summary ?? ""}`
    )
    .join("\n\n");
  return { terms, judged, summaryBlock };
}

function bodyMaterialOf(opened) {
  return opened.length === 0 ? "" : opened.map((row) => `# ${row.page.title}\n\n${row.page.body}`).join("\n\n");
}

/**
 * Summary-first v1. Rank title + summary + tags only, show those compact
 * summaries, and open full markdown bodies only when none of the candidates
 * covers enough query terms.
 *
 * A candidate covers the question when the number of unique query terms found
 * in its title, summary, and tags is at least max(1, ceil(terms * coverFraction)).
 * If any of the top `summaryK` covers, open nothing. Otherwise open up to
 * `maxBodies` full bodies, in rank order. This rule is fixed. Do not retune it
 * to chase a score. The headline policy no longer uses it. Live docs showed it
 * skips bodies that hold the answer.
 */
export function summaryFirstV1(pages, queryText, stopwords, options) {
  const { terms, judged, summaryBlock } = summaryHits(pages, queryText, stopwords, options.summaryK);
  const need = Math.max(1, Math.ceil(terms.length * options.coverFraction));
  const anyCover = judged.some((row) => row.covered >= need);
  const opened = anyCover ? [] : judged.slice(0, options.maxBodies);
  const decisionLine = anyCover
    ? "Decision: answer from summaries."
    : `Decision: open ${opened.map((row) => row.page.slug).join(", ")}.`;
  const summaryMaterial = `Candidate summaries:\n${summaryBlock}\n\n${decisionLine}\n`;
  return {
    candidate_slugs: judged.map((row) => row.page.slug),
    opened_slugs: opened.map((row) => row.page.slug),
    decision: anyCover ? "answer" : "open",
    cover_need: need,
    summaryBlock,
    summaryMaterial,
    bodyMaterial: bodyMaterialOf(opened),
  };
}

/**
 * Headline summary-first proxy. A live model sees the top summaries and
 * either answers or replies `OPEN slug`. Offline cannot call that model.
 *
 * The proxy does not look at the expected answer. It opens the top body
 * unless it is strongly confident the top hit is enough: every query
 * term appears in that page's title, summary, or tags, the runner-up covers less than
 * `runnerUpCoverFraction` of the terms, and the second score is below
 * `closeScoreRatio` of the first. When the top two scores are that close,
 * it opens both. It never opens more than `maxBodies` (2).
 */
export function summaryFirst(pages, queryText, stopwords, options) {
  const maxBodies = options.maxBodies ?? 2;
  const closeScoreRatio = options.closeScoreRatio ?? 0.85;
  const runnerUpCoverFraction = options.runnerUpCoverFraction ?? 0.5;
  const { terms, judged, summaryBlock } = summaryHits(pages, queryText, stopwords, options.summaryK);
  const top = judged[0];
  const second = judged[1];
  const scoreRatio = top && second && top.hit.score > 0 ? second.hit.score / top.hit.score : 0;
  const close = Boolean(second) && scoreRatio >= closeScoreRatio;
  const runnerUpWeak =
    !second || terms.length === 0 || second.covered / terms.length < runnerUpCoverFraction;
  const strong = Boolean(top) && terms.length >= 2 && top.covered === terms.length && runnerUpWeak && !close;
  let opened;
  let decision;
  if (!top || strong) {
    opened = [];
    decision = strong ? "answer" : "open";
  } else if (close) {
    opened = judged.slice(0, Math.min(2, maxBodies));
    decision = "open";
  } else {
    opened = judged.slice(0, Math.min(1, maxBodies));
    decision = "open";
  }
  const openInstruction =
    "If one of these summaries clearly contains the answer, reply with that answer and a short quote from the summary. If it does not, reply with a single line: OPEN slug or OPEN slug, slug. Use only slugs from the list above, and at most 2.";
  const summaryMaterial = `Candidate summaries:\n${summaryBlock}\n\n${openInstruction}\n`;
  return {
    candidate_slugs: judged.map((row) => row.page.slug),
    opened_slugs: opened.map((row) => row.page.slug),
    decision,
    cover_need: terms.length,
    summaryBlock,
    summaryMaterial,
    bodyMaterial: bodyMaterialOf(opened),
    strong,
    close,
    score_ratio: Number(scoreRatio.toFixed(6)),
  };
}
