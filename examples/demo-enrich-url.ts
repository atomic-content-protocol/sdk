#!/usr/bin/env npx tsx
/**
 * ACP Demo: Enrich a URL
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx examples/demo-enrich-url.ts https://stacklist.app/some-stack
 *
 * Or source your .env:
 *   export $(cat .env | xargs) && npx tsx examples/demo-enrich-url.ts https://example.com/article
 */

import { createACO, FilesystemAdapter, serializeACO } from '@acp/core';
import { ProviderRouter, UnifiedPipeline, EmbedPipeline } from '@acp/enrichment';
import { execSync } from 'node:child_process';

function getGitUser(): { id: string; name: string } {
  try {
    const name = execSync('git config user.name', { encoding: 'utf-8' }).trim();
    const email = execSync('git config user.email', { encoding: 'utf-8' }).trim();
    return { id: email || 'unknown', name: name || 'Unknown' };
  } catch { return { id: 'unknown', name: 'Unknown' }; }
}

async function main() {

const url = process.argv[2];
if (!url) {
  console.error('Usage: npx tsx examples/demo-enrich-url.ts <url>');
  process.exit(1);
}

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable');
  process.exit(1);
}

// 1. Fetch the page content
console.log(`\n🔗 Fetching: ${url}\n`);
const response = await fetch(url);
const html = await response.text();

// Extract text content (simple HTML strip — production would use Trafilatura/Jina)
const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || url;
const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1];
const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1];
const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1];
const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1]
  || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i)?.[1];
const ogImageType = html.match(/<meta[^>]*property="og:image:type"[^>]*content="([^"]+)"/i)?.[1]
  || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image:type"/i)?.[1];

// Strip HTML tags for body content
const bodyText = html
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
  .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
  .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 5000);

const finalTitle = ogTitle || title;
const description = ogDesc || metaDesc || '';
const body = description ? `${description}\n\n${bodyText}` : bodyText;

console.log(`📄 Title: ${finalTitle}`);
console.log(`📏 Content: ${body.length} chars\n`);

// 2. Create the ACO
const storage = new FilesystemAdapter('./demo-vault');
const author = getGitUser();
const extraFrontmatter: Record<string, unknown> = { source_url: url };
if (ogImage) {
  extraFrontmatter.media = { url: ogImage, mime_type: ogImageType || 'image/jpeg' };
}
const aco = await createACO({
  title: finalTitle,
  body,
  source_type: 'link',
  author,
  frontmatter: extraFrontmatter,
});

// 3. Set up enrichment
const providerConfig: Record<string, unknown> = {};
if (process.env.ANTHROPIC_API_KEY) {
  providerConfig.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY };
}
if (process.env.OPENAI_API_KEY) {
  providerConfig.openai = { apiKey: process.env.OPENAI_API_KEY };
}
const router = ProviderRouter.fromConfig(providerConfig as any);

// 4. Enrich with unified pipeline (tags + summary + entities + classification in one call)
console.log('🧠 Enriching with AI...\n');
const unified = new UnifiedPipeline();
const result = await unified.enrich(aco, router, { force: true });
const enriched = result.aco;

// 5. Save to vault
await storage.putACO(enriched);

// 6. Display the result
const fm = enriched.frontmatter as Record<string, unknown>;
console.log('━'.repeat(60));
console.log(`✅ Enriched ACO: ${fm.id}`);
console.log('━'.repeat(60));
console.log(`\n📌 Title: ${fm.title}`);
console.log(`🔗 Source: ${fm.source_url}`);
console.log(`📝 Summary: ${fm.summary}`);
console.log(`🏷️  Tags: ${(fm.tags as string[])?.join(', ')}`);
console.log(`📂 Classification: ${fm.classification}`);
if (ogImage) {
  console.log(`🖼️  OG Image: ${ogImage}`);
}

const entities = fm.key_entities as Array<{ name: string; type: string; confidence: number }>;
if (entities?.length) {
  console.log(`🔍 Entities:`);
  for (const e of entities) {
    console.log(`   - ${e.name} (${e.type}, ${(e.confidence * 100).toFixed(0)}%)`);
  }
}

const prov = fm.provenance as Record<string, { model: string }>;
if (prov) {
  const model = Object.values(prov)[0]?.model;
  console.log(`\n🤖 Enriched by: ${model}`);
}

console.log(`\n📁 Saved to: ./demo-vault/${fm.id}.md`);

// 7. Also print the raw markdown file
console.log('\n━'.repeat(60));
console.log('Raw ACO file:');
console.log('━'.repeat(60));
console.log(serializeACO(enriched.frontmatter, enriched.body).slice(0, 2000));
if (enriched.body.length > 2000) console.log('... (truncated)');

}

main().catch(console.error);
