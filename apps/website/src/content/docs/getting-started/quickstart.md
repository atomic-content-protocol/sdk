---
title: Quick Start
description: Three ways to create your first Atomic Content Object.
---

An ACO is just a Markdown file with structured YAML frontmatter. You can create one right now with a text editor — no dependencies required.

---

## Path 1: Write one by hand

The minimal valid ACO has exactly six required fields. Create a file called `my-first-aco.md`:

```yaml
---
id: "550e8400-e29b-41d4-a716-446655440000"
acp_version: "0.2"
object_type: "aco"
source_type: "manual"
created: "2026-04-10T12:00:00Z"
author:
  id: "your-user-id"
  name: "Your Name"
---

Your knowledge content goes here. This is standard Markdown.

You can use **bold**, _italics_, `code`, headers, lists, and anything else CommonMark supports.
```

That is a valid ACO. You can open it in Obsidian, any text editor, or process it with any Markdown parser.

### The six required fields

| Field | What it is |
|-------|-----------|
| `id` | Globally unique identifier. UUID v7 recommended; UUID v4 accepted. |
| `acp_version` | Protocol version. Use `"0.2"` for the current spec. |
| `object_type` | Always `"aco"` for a knowledge object. |
| `source_type` | How this was created: `manual`, `link`, `uploaded_md`, `converted_pdf`, `converted_doc`, `converted_video`, `selected_text`, `llm_capture`. |
| `created` | ISO 8601 timestamp with timezone, e.g. `"2026-04-10T12:00:00Z"`. |
| `author` | Object with `id` and `name` subfields. |

### Adding optional fields

Once the required fields are in place, you can add as much or as little enrichment as you need:

```yaml
---
id: "550e8400-e29b-41d4-a716-446655440000"
acp_version: "0.2"
object_type: "aco"
source_type: "link"
created: "2026-04-10T12:00:00Z"
author:
  id: "your-user-id"
  name: "Your Name"

# Optional enrichment
title: "My notes on the ACP spec"
language: "en"
tags: ["acp", "knowledge-management", "notes"]
summary: "Personal notes covering the ACP schema and how to implement it."

# Optional access control
visibility: "private"
agent_accessible: false
status: "draft"
---

Content here.
```

---

## Path 2: Use the CLI

The ACP CLI scaffolds and enriches ACOs from the command line.

### Initialize a vault

```bash
npx @acp/cli init ./my-vault
```

This creates a directory with a `.acp/` config folder. ACOs you create in this directory will automatically get the right structure.

### Create an ACO

```bash
npx @acp/cli create --title "My First ACO" --source-type manual
```

This creates a new `.md` file pre-populated with a generated UUID, the current timestamp, and all required fields. Open the file to add your content.

For a link-based ACO, pass a URL and the CLI will fetch and extract the content:

```bash
npx @acp/cli create --url "https://example.com/article"
```

### Enrich an ACO

Once a file has content, enrich it with AI-generated metadata:

```bash
npx @acp/cli enrich ./my-vault/my-first-aco.md
```

This adds `summary`, `tags`, `key_entities`, and `token_counts` — all with per-field provenance records showing which model generated each field.

To enrich all ACOs in a vault:

```bash
npx @acp/cli enrich ./my-vault/
```

### Validate

Check that your ACOs are spec-compliant:

```bash
npx @acp/cli validate ./my-vault/my-first-aco.md
```

---

## Path 3: Use the Stacklist MCP

The Stacklist MCP server provides zero-setup ACO enrichment. If you have an MCP-compatible client (Claude Desktop, Cursor, or any MCP host), you can enrich content immediately.

### Enrich a URL

```
Tool: enrich_url
Input: { "url": "https://example.com/article" }
```

Returns a fully enriched ACO with `title`, `summary`, `tags`, `key_entities`, `token_counts`, and complete per-field provenance.

### Enrich raw content

```
Tool: enrich_content
Input: {
  "content": "Your text content here...",
  "source_type": "manual",
  "title": "My ACO"
}
```

### Save an LLM output

If you want to capture the output of an AI conversation as an ACO:

```
Tool: save_llm_output
Input: {
  "content": "The LLM response to save...",
  "model": "claude-sonnet-4-6",
  "title": "AI answer about X"
}
```

This creates an ACO with `source_type: "llm_capture"` and a populated `source_context` object — full provenance for AI-generated content.

---

## Next Steps

- Read the [ACO field reference](/spec/aco/) for the complete schema
- See [ACO Examples](/examples/aco-examples/) for real-world patterns
- Understand [Enrichment and Provenance](/spec/enrichment/) to know how auto-generated fields work
