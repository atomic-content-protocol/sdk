import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://atomiccontentprotocol.org',
  integrations: [
    starlight({
      title: 'Atomic Content Protocol',
      description: 'An open standard that makes knowledge portable and readable by both humans and AI.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/atomic-content-protocol/sdk' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'What is ACP?', slug: 'getting-started/what-is-acp' },
            { label: 'Quick Start', slug: 'getting-started/quickstart' },
          ],
        },
        {
          label: 'Specification',
          items: [
            { label: 'ACO (Atomic Content Object)', slug: 'spec/aco' },
            { label: 'Container', slug: 'spec/container' },
            { label: 'Collection', slug: 'spec/collection' },
            { label: 'Enrichment & Provenance', slug: 'spec/enrichment' },
            { label: 'Relationships', slug: 'spec/relationships' },
            { label: 'Access Model', slug: 'spec/access' },
          ],
        },
        {
          label: 'Examples',
          items: [
            { label: 'ACO Examples', slug: 'examples/aco-examples' },
          ],
        },
        {
          label: 'Benchmark',
          items: [
            { label: 'Token Savings', slug: 'benchmark' },
          ],
        },
        {
          label: 'Playground',
          items: [
            { label: 'Try ACP', link: '/playground' },
          ],
        },
      ],
      favicon: '/favicon.svg',
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://atomiccontentprotocol.org/favicon.svg' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:type', content: 'website' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary' },
        },
        {
          tag: 'link',
          attrs: { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        },
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: '/favicon.svg' },
        },
      ],
      customCss: [],
    }),
  ],
});
