# Corpus attribution

The cached page text in `corpus/pages/` and the bodies of the Atomic Content Objects in `corpus/vault/` are plaintext extracts of English Wikipedia articles.

- Source: [English Wikipedia](https://en.wikipedia.org/), retrieved through the MediaWiki `action=query` API (`prop=extracts|revisions|categories`, `explaintext=1`) on 2026-10-22.
- License of that text: [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/) (CC BY-SA 4.0).
- Each article URL, page title, and MediaWiki revision id are in `corpus/manifest.json` and `corpus/sources.json`.
- Modifications: the extract is the article plaintext only (no MediaWiki markup), and each body is capped at 100,000 characters. Summaries, tags, and entities on the ACOs were derived from that text by the rules in `src/build-corpus.ts`. They are not the original Wikipedia lead sections copied as metadata, and they were not written by a language model.
- Each ACO records `rights: CC-BY-SA-4.0`.

The rest of this example (harness, policy, questions, image definition) is part of this repository and is under the repository's Apache-2.0 license. That license does not replace the CC BY-SA 4.0 terms on the Wikipedia extracts.
