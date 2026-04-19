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
acp init <path>              Initialise a new ACO vault
acp create                   Create a new ACO interactively
acp validate <path>          Validate one or more ACOs against the schema
acp enrich <path>            Enrich an ACO with tags, summary, entities
acp enrich-batch <path>      Enrich every ACO in a directory
acp search <query>           Search ACOs in a vault
acp serve <path>             Start an MCP server over a vault
acp stats <path>             Token counts and enrichment coverage for a vault
```

Run `acp <command> --help` for options.

## Configuration

Set your provider keys as environment variables before running enrichment:

```bash
export ANTHROPIC_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
```

## Links

- Protocol spec: [atomiccontentprotocol.org](https://atomiccontentprotocol.org)
- Repository: [github.com/atomic-content-protocol/sdk](https://github.com/atomic-content-protocol/sdk)

## Stewardship

The Atomic Content Protocol is an open standard stewarded by [Stacks, Inc](https://www.stacks.inc/) — the company behind [Stacklist](https://stacklist.com).

## License

Apache-2.0
