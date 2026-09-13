# @atomic-content-protocol/cli

Command-line tool for the [Atomic Content Protocol](https://atomiccontentprotocol.org) — create, validate, enrich, search, and serve ACOs from your terminal.

## Install

```bash
npm install -g @atomic-content-protocol/cli
```

Or run without installing:

```bash
npx @atomic-content-protocol/cli init ./my-vault
```

## Commands

```
acp init [path]                 Initialise a vault (.acp/config.json) in path (default: .)
acp create                      Create an ACO from --title/--body or --url
acp validate [path]             Validate every ACO in a vault, or one .md file
acp enrich <id>                 Enrich one ACO with tags, summary, entities, classification
acp enrich-batch                Enrich every ACO in the vault (filters, budget, concurrency)
acp search <query>              Full-text search over titles and bodies
acp serve                       Start the MCP server (stdio) over the vault
acp stats                       Counts, enrichment coverage and token totals
```

Every command accepts `--vault <path>`. Without it, the CLI walks up from the current directory to the nearest `.acp/config.json` (like `git` finds `.git`), and falls back to the current directory.

Run `acp <command> --help` for options.

### Examples

```bash
acp init ./vault --yes
acp create --title "Why ACP exists" --body "Knowledge that can't be found isn't useful." --tags protocol,knowledge
acp create --url https://example.com/article            # fetched, source_type=link
acp enrich 0193f5e6-... --pipelines unified,embed --yes  # embed needs OpenAI or Ollama
acp enrich-batch --filter-status draft --max-cost 0.50 --concurrency 4 --yes
acp validate --json
```

`--max-cost` is enforced *before* anything is sent to a provider: the CLI estimates each ACO, enriches as many as fit the budget, and reports the rest as deferred.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Runtime error (provider failure, missing ACO, …) |
| 2 | Usage error (bad flag, invalid config) |
| 3 | `validate` found invalid ACOs |
| 4 | Enrichment requested but no provider configured |

Set `ACP_DEBUG=1` to see stack traces.

## Configuration

Provider keys come from the environment:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...          # also enables the embed pipeline
export ACP_QUALITY=fast               # fast (default) | balanced | best
```

`.acp/config.json` (written by `acp init`):

```json
{
  "vault_path": ".",
  "author": { "id": "you@example.com", "name": "Your Name" },
  "enrichment": {
    "quality": "fast",
    "anthropic": { "model": "claude-haiku-4-5" },
    "openai": { "model": "gpt-5.6-luna", "embedding_model": "text-embedding-3-small" }
  }
}
```

`vault_path` is relative to the config file, so a vault can be moved or committed. Unknown keys are rejected so typos are caught.

### Claude Desktop

```json
{
  "mcpServers": {
    "acp": {
      "command": "npx",
      "args": ["@atomic-content-protocol/cli", "serve", "--vault", "/path/to/vault"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

## Links

- Protocol spec: [atomiccontentprotocol.org](https://atomiccontentprotocol.org)
- Repository: [github.com/atomic-content-protocol/sdk](https://github.com/atomic-content-protocol/sdk)

## Stewardship

The Atomic Content Protocol is an open standard stewarded by [Stacks, Inc](https://www.stacks.inc/) — the company behind [Stacklist](https://stacklist.com).

## License

Apache-2.0
