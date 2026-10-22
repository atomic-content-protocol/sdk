# Docs corpus attribution

The Daytona documentation measured here was fetched on 2026-10-22 from the public markdown URLs listed by [llms.txt](https://www.daytona.io/docs/llms.txt). The raw page text is not committed. `src/build-docs.ts` downloads it into `corpus/pages/` and writes ACO files under `corpus/vault/`. Both paths are gitignored.

- Index: [https://www.daytona.io/docs/llms.txt](https://www.daytona.io/docs/llms.txt), fetched on 2026-10-22.
- Each page URL is the markdown document that index links, for example `https://www.daytona.io/docs/en/snapshots.md`. The list is `corpus/sources.json`.
- The index listed about 190 markdown URLs. This demo keeps 54 product docs (sandboxes, snapshots, volumes, network limits, authentication, computer use, the SDK overviews, and the other top-level guides). It does not copy the OpenAPI files, `llms-full.txt`, the 404 page, the per-class SDK reference trees, or the third-party integration guides.
- `sandboxes` and `mount-external-storage` were longer than 100,000 characters and the local cache truncates them at that cap.
- Copyright in that text stays with Daytona. A local cache is for running the benchmark. It is not relicensed, and the Apache-2.0 license of this repository does not apply to it.
- Summaries, tags, and entities on the ACOs are derived from the cached markdown by the rules in `src/build-docs.ts` when you run it. They were not written by a language model, and they are not Daytona's own metadata. The committed results record token counts and which slugs were opened. They do not include the page bodies.
- `corpus/questions.json` quotes a short expected answer span from each gold page so the offline check can run without the cache. Those spans are the benchmark labels, not a copy of the docs.

No Daytona terms page found during the fetch granted a reuse license for the docs. Source and date are recorded on `corpus/manifest.json`.
