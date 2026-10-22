# Docs corpus attribution

The cached pages in `corpus/pages/` and the bodies of the Atomic Content Objects in `corpus/vault/` are copies of public Daytona documentation.

- Index: [https://www.daytona.io/docs/llms.txt](https://www.daytona.io/docs/llms.txt), fetched on 2026-10-22.
- Each page URL is the markdown document that index links, for example `https://www.daytona.io/docs/en/snapshots.md`. The list is `corpus/sources.json`.
- The index listed about 190 markdown URLs. This demo keeps 54 product docs (sandboxes, snapshots, volumes, network limits, authentication, computer use, the SDK overviews, and the other top-level guides). It does not copy the OpenAPI files, `llms-full.txt`, the 404 page, the per-class SDK reference trees, or the third-party integration guides.
- `sandboxes` and `mount-external-storage` were longer than 100,000 characters and are stored truncated at that cap.
- Copyright in that text stays with Daytona. These files are a cache for the benchmark. They are not relicensed, and the Apache-2.0 license of this repository does not apply to them.
- Summaries, tags, and entities on the ACOs were derived from the cached markdown by the rules in `src/build-docs.ts`. They were not written by a language model, and they are not Daytona's own metadata.

No Daytona terms page found during the fetch granted a reuse license for the docs. The cache is limited to the public markdown URLs, with source and date recorded on `corpus/manifest.json`.
