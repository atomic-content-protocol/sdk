# @atomic-content-protocol/web

Make any website readable by AI agents through ACP, and measure who reads it.

- **Build:** every page becomes `<path>.md`, an Atomic Content Object made the same way Stacklist makes card ACOs (`createACO`, `status: final`, `agent_accessible: true`, `source_url`, UnifiedPipeline enrichment). Pages keep their `id` across rebuilds; unchanged pages are not re-enriched. `/.well-known/acp.json` lists every page with its token cost as HTML and as ACO.
- **Serve:** a dependency-free edge handler (Cloudflare Workers, Deno, Bun, Node) that gives agents the ACO without them knowing ACP exists, and never changes what search engines and people see.
- **Measure:** each agent visit becomes a PostHog `bot_fetch` event (the event and `bot_class` values Stacklist already uses), with what was served and what it cost.

## 1. Build the ACOs

```bash
# From a static export
npx acp-web build --from out --origin https://example.com --out out

# From a running site (server-rendered frameworks): reads its sitemap
npx acp-web build --from http://localhost:3000 --origin https://example.com --out public
```

Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to enrich (summary, tags, key entities); `--no-enrich` skips it.

```
new       /         24358 → 2042 tokens
4 pages as ACOs. An agent reading every page pays 7,610 tokens instead of 81,204 (90.6% less).
```

Or from code: `buildSiteACOs({ pages, origin, outDir, author, enrich })` with `pagesFromDirectory(dir)` or `pagesFromSitemap(url)` from `@atomic-content-protocol/web/build`.

## 2. Serve them

```ts
import { handleWithACP, posthogSink } from "@atomic-content-protocol/web";

export default {
  fetch: (request, env, ctx) =>
    handleWithACP(request, {
      fetchPage: (req) => env.ASSETS.fetch(req), // or your framework's handler, or fetch(origin)
      onHit: posthogSink({ apiKey: env.POSTHOG_KEY, properties: { site: "example.com" } }),
      waitUntil: (p) => ctx.waitUntil(p),
    }),
};
```

Who gets what:

| Request | Response |
|---|---|
| `GET /about.md` | the ACO |
| `Accept: text/markdown` preferred over HTML | the ACO |
| AI assistants and AI crawlers (`serveTo: "ai"`, default) | the ACO |
| Search crawlers (Googlebot, Bingbot…) and people | the page, always |

Every HTML page gets `Link: </about.md>; rel="alternate"; type="text/markdown"`. ACO responses carry `rel="canonical"` back to the page and `Vary: Accept, User-Agent`. Agents are classified by Cloudflare's `verifiedBotCategory` first, then by user agent.

## 3. Measure

Events are `bot_fetch` with Stacklist's properties (`bot_class`, `verified_bot_category`, `path`, `user_agent`, `status`, `bytes_served`…) plus `served_format` (`html` | `aco`), `acp_reason` (`md_url` | `accept` | `agent`), `aco_available`, `agent_name` and `tokens_served_approx`. Exact per-page token costs are in `/.well-known/acp.json`.

Note: frontmatter costs roughly 250 tokens per page, so on a page that is almost pure text the ACO can cost more than the HTML. Real builder and framework pages are mostly markup and scripts, which is where the savings come from; the manifest shows both numbers for every page.
