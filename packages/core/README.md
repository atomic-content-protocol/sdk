# @atomic-content-protocol/core

Core schema, validation, and file I/O for the [Atomic Content Protocol](https://atomiccontentprotocol.org).

An **Atomic Content Object (ACO)** is a Markdown file with structured YAML frontmatter — a format that's both human-readable and machine-addressable.

## Install

```bash
npm install @atomic-content-protocol/core
```

## Quick start

```typescript
import { createACO, validateACO, parseACO, serializeACO } from "@atomic-content-protocol/core";

const aco = createACO({
  title: "My First ACO",
  author: { id: "you@example.com", name: "Your Name" },
  body: "# Hello, world\n\nThe smallest valid ACO.",
});

const markdown = serializeACO(aco);
const parsed = parseACO(markdown);
```

## What's in the package

- `schema/` — Zod validators for ACO, Container, Collection, edges, provenance
- `types/` — Runtime TypeScript interfaces
- `io/` — `parseACO`, `parseAndValidateACO`, `serializeACO`
- `storage/` — `IStorageAdapter`, `FilesystemAdapter`
- `graph/` — `getRelatedACOs` for relationship traversal
- `utils/` — `generateId`, `computeContentHash`, `computeTokenCounts`, error classes
- `migrate` — version migration helpers

## Links

- Protocol spec: [atomiccontentprotocol.org](https://atomiccontentprotocol.org)
- Repository: [github.com/atomic-content-protocol/sdk](https://github.com/atomic-content-protocol/sdk)
- Issues: [github.com/atomic-content-protocol/sdk/issues](https://github.com/atomic-content-protocol/sdk/issues)

## Stewardship

The Atomic Content Protocol is an open standard stewarded by [Stacks, Inc](https://www.stacks.inc/) — the company behind [Stacklist](https://stacklist.com).

## License

Apache-2.0
