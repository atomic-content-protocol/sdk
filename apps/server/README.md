# acp-server

The hosted ACP enrichment server behind [`mcp.atomiccontentprotocol.org`](https://mcp.atomiccontentprotocol.org/mcp). A stateless, streamable-HTTP MCP endpoint that turns text or URLs into enriched Atomic Content Objects using the caller-free API key we pay for.

Private to this repository (not published to npm). To run your own vault-backed server instead, use [`@atomic-content-protocol/mcp`](../../packages/mcp).

## Endpoints

| Route | Purpose |
|---|---|
| `POST /mcp` | MCP JSON-RPC (stateless streamable HTTP). Tools: `enrich_content`, `enrich_url`, `enrich_batch`. |
| `GET /health` | Liveness plus the effective configuration (version, providers, tier, auth mode, limits). |
| `GET /mcp`, `DELETE /mcp` | `405` — there are no sessions in stateless mode. |

## Run locally

```bash
cp .env.example .env        # set ANTHROPIC_API_KEY
npm run dev                 # tsx watch
npm test                    # 30 tests, no network
```

## Configuration

Every value has a safe default; only a provider key is required, and the server refuses to start without one. See [`.env.example`](.env.example) for the full list.

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | At least one required. |
| `ENRICHMENT_QUALITY` | `fast` | `fast` (Haiku 4.5 / GPT-5.6 Luna), `balanced`, `best`. |
| `TRUST_PROXY` | `1` | Reverse-proxy hops in front. `true` lets clients spoof their IP and is warned about at boot. |
| `RATE_LIMIT_PER_HOUR` | `50` | Weighted units per client per hour. A batch of N items costs N; the MCP handshake is free. |
| `MCP_API_KEYS` | unset | Comma-separated bearer tokens. When set, `/mcp` requires one; failed attempts are metered per IP. |
| `CORS_ORIGINS` | unset | Browser origins allowed to call `/mcp`. Non-browser MCP clients send no `Origin` and are unaffected. |
| `DAILY_COST_CAP_USD` | unset | Global estimated-spend ceiling per UTC day. See below. |
| `MAX_CONTENT_LENGTH` | `50000` | Characters per item. The JSON body limit is derived from it. |

### Choosing `DAILY_COST_CAP_USD`

The cap is a blast-radius limit, not a quota: it counts the *estimated* cost of every enrichment across all clients and, once exhausted, answers `BUDGET_EXCEEDED` to everyone until 00:00 UTC. Set it to the most you are willing to lose in a day.

| Cap | Roughly | Fits |
|---|---|---|
| `5` | 1,650 enrichments/day | A public demo server. One client saturating the hourly limit for a full day spends about $3.60. |
| `25` | 8,300 enrichments/day | Launch traffic or a handful of heavy integrations. |
| unset | unbounded | Only do this behind `MCP_API_KEYS`. |

Tune it from the `enrichment_completed` events in PostHog, which carry the per-call `enrichment_cost`.

## Deploy (Railway)

[`railway.json`](railway.json) pins the build:

- Install runs in the Nixpacks install phase as `npm ci --include=dev`. The `--include=dev` matters because Railway sets the npm `production` config, and the build needs TypeScript, turbo and `@types/*`. Do **not** add `npm ci` to `buildCommand`; it fails with `EBUSY` on the cache directory Nixpacks mounts inside `node_modules`.
- `buildCommand` only compiles: `npx turbo build --filter=acp-server`.
- `startCommand` runs the compiled entry point, which shuts down gracefully on `SIGTERM` and flushes PostHog first.

Recommended production variables: `CORS_ORIGINS=https://atomiccontentprotocol.org` and a `DAILY_COST_CAP_USD`.

## Security posture

HTTPS-only, SSRF-guarded fetching via `@atomic-content-protocol/core` (private, loopback, link-local, CGNAT, mapped-IPv6 and NAT64 ranges refused; DNS resolved before connecting; redirects not followed; response size capped). Helmet is on, CORS is closed by default, tool failures never echo upstream provider text, and per-request MCP servers and transports are closed when the response ends.

## License

Apache-2.0
