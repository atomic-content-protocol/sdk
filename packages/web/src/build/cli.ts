#!/usr/bin/env node
/**
 * acp-web build --from <dir | http(s) url> --origin <https://site> --out <dir> [--author "Name"] [--no-enrich] [--limit n]
 *
 *   --from    A static export folder (out/, dist/), or a running site whose sitemap lists its pages.
 *   --origin  The public address, for source_url and the manifest.
 *   --out     Where the site's static files are served from; ACOs and the manifest go here.
 *
 * Enrichment uses ANTHROPIC_API_KEY or OPENAI_API_KEY when set, unless --no-enrich.
 */

import { parseArgs } from "node:util";
import { buildSiteACOs, pagesFromDirectory, pagesFromSitemap } from "./index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: "string" },
    origin: { type: "string" },
    out: { type: "string" },
    author: { type: "string" },
    "no-enrich": { type: "boolean", default: false },
    limit: { type: "string" },
  },
});

if (positionals[0] !== "build" || !values.from || !values.origin || !values.out) {
  console.error(
    "Usage: acp-web build --from <dir|url> --origin <https://site> --out <dir> [--author name] [--no-enrich] [--limit n]"
  );
  process.exit(1);
}

const host = new URL(values.origin).host;
const fromUrl = /^https?:\/\//.test(values.from);
const manifest = await buildSiteACOs({
  pages: fromUrl
    ? pagesFromSitemap(values.from, { limit: values.limit ? Number(values.limit) : undefined })
    : pagesFromDirectory(values.from),
  origin: values.origin,
  outDir: values.out,
  author: { id: host, name: values.author ?? host },
  enrich: values["no-enrich"]
    ? false
    : { anthropicApiKey: process.env.ANTHROPIC_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY },
  log: (line) => console.log(line),
});

const { totals } = manifest;
console.log(
  `\n${totals.pages} pages as ACOs. An agent reading every page pays ${totals.aco_tokens.toLocaleString()} tokens instead of ${totals.html_tokens.toLocaleString()} (${totals.saved_percent}% less).`
);
if (manifest.skipped.length)
  console.log(`Skipped ${manifest.skipped.length}: ${manifest.skipped.map((s) => s.path).join(", ")}`);
