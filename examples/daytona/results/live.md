# Live Daytona run

Status: pending.

No live sandboxes were started for the commit that added this file. `DAYTONA_API_KEY` was not set in that environment, so this file has no sandbox timings, model token usage, or answer scores.

The default live comparison is ACP against search-then-read (BM25, top 3). That prompt is the one meant to fit a normal context window. Naive full-read is an upper bound and is sent only when `ACP_LIVE_BASELINE` is `naive` or `both`.

`npm run live` overwrites this file only after a real run. It does not fill missing rows with estimates.
