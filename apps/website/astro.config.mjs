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
          label: 'Connect',
          items: [
            { label: 'Connect to Claude', slug: 'connect' },
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
          tag: 'script',
          content: `!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="Mi Ri init Vi Gi Rr Wi Ji Bi capture calculateEventProperties tn register register_once register_for_session unregister unregister_for_session an getFeatureFlag getFeatureFlagPayload getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync un identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty nn Xi createPersonProfile setInternalOrTestUser sn Hi cn opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Ki debug Lr rn getPageViewId captureTraceFeedback captureTraceMetric Di".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('phc_qEkWuNu8ejWudEzUisfWKfkvd8CsG3Yfafg9cFSV7XaH', {
    api_host: 'https://yippiekiyay.stacklist.com',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
    person_profiles: 'identified_only',
});`,
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://atomiccontentprotocol.org/og-default.png' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:width', content: '1200' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:height', content: '630' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:type', content: 'website' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://atomiccontentprotocol.org/og-default.png' },
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
