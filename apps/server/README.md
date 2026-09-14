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
| `RATE_LIMIT_PER_HOUR` | `50` | Weighted units per client per hour, per instance. A batch of N items costs N; the MCP handshake is free. |
| `MCP_API_KEYS` | unset | Comma-separated bearer tokens. When set, `/mcp` requires one; failed attempts are metered per IP. |
| `CORS_ORIGINS` | unset | Browser origins allowed to call `/mcp`. Non-browser MCP clients send no `Origin` and are unaffected. |
| `DAILY_COST_CAP_USD` | unset | Estimated-spend ceiling per UTC day, per instance. See below. |
| `MAX_CONTENT_LENGTH` | `50000` | Characters per item. The JSON body limit is derived from it. |

### Choosing `DAILY_COST_CAP_USD`

The cap is a blast-radius limit, not a quota: it counts the *estimated* cost of every enrichment across all clients and, once exhausted, answers `BUDGET_EXCEEDED` to everyone until 00:00 UTC. Set it to the most you are willing to lose in a day.

> **Replicas multiply both budgets.** The rate limiter and the spend guard are in-memory, so each instance enforces its own copy. With two replicas a `50`/hour limit is really 100/hour and a `$10` cap is really `$20`, and clients see `RateLimit-Remaining` jump around as requests land on different instances. Every response carries an `X-ACP-Instance` header (also reported as `instance` by `GET /health`): if a burst of requests returns more than one value, you have more than one replica. Either run a single replica, or divide the figures below by the replica count.

| Cap | Roughly | Fits |
|---|---|---|
| `5` | 1,650 enrichments/day | A public demo server. One client saturating the hourly limit for a full day spends about $3.60. |
| `25` | 8,300 enrichments/day | Launch traffic or a handful of heavy integrations. |
| unset | unbounded | Only do this behind `MCP_API_KEYS`. |

Tune it from the `enrichment_completed` events in PostHog, which carry the per-call `enrichment_cost`.

## Deploy (Railway)

[`railway.json`](railway.json) pins the build:

```json
"buildCommand": "npm install --include=dev --no-audit --no-fund && npx turbo build --filter=acp-server"
```

Two constraints are baked into that one line, each learned from a failed deploy:

- **`--include=dev`, not a bare install.** Railway sets npm's `production` config, so the platform's own install phase omits `devDependencies` and `tsc` fails with `TS7016` on `express` and `cors`. Only `--include=dev` overrides that config; `--omit=` does not. A `nixpacksPlan.phases.install` override is accepted by the schema but was ignored in practice, so the build command does the work itself.
- **`npm install`, not `npm ci`.** `npm ci` deletes `node_modules` before installing, and Nixpacks mounts its build cache at `node_modules/.cache`, which cannot be removed — the build dies with `EBUSY`. `npm install` reconciles in place against the committed lockfile and leaves the mount alone.

`startCommand` runs the compiled entry point, which shuts down gracefully on `SIGTERM` and flushes PostHog first.

Recommended production variables: `CORS_ORIGINS=https://atomiccontentprotocol.org` and a `DAILY_COST_CAP_USD`.

## Security posture

HTTPS-only, SSRF-guarded fetching via `@atomic-content-protocol/core` (private, loopback, link-local, CGNAT, mapped-IPv6 and NAT64 ranges refused; DNS resolved before connecting; redirects followed only after re-validating every hop, max 5; response size capped). Helmet is on, CORS is closed by default, tool failures never echo upstream provider text, and per-request MCP servers and transports are closed when the response ends.

## License

Apache-2.0
