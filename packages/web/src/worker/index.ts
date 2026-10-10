/**
 * @atomic-content-protocol/web: edge half.
 *
 * Runtime-agnostic (Cloudflare Workers, Deno, Bun, Node ≥ 20): only the Fetch
 * API, no dependencies. The build half lives in `@atomic-content-protocol/web/build`.
 *
 * Smallest Cloudflare Worker in front of a site whose ACOs sit in its assets:
 *
 *   import { handleWithACP, posthogSink } from "@atomic-content-protocol/web";
 *   export default {
 *     fetch: (request, env, ctx) =>
 *       handleWithACP(request, {
 *         fetchPage: (req) => env.ASSETS.fetch(req),
 *         onHit: posthogSink({ apiKey: env.POSTHOG_KEY }),
 *         waitUntil: (p) => ctx.waitUntil(p),
 *       }),
 *   };
 */

export { type Agent, type BotClass, classifyAgent, isAI, isSearchCrawler, VERIFIED_BOT_MAP } from "./classify.js";
export { type HitEvent, type PostHogSinkOptions, posthogSink, toEvent } from "./posthog.js";
export {
  ACO_MEDIA_TYPE,
  type ACPOptions,
  acoPathFor,
  type Hit,
  handleWithACP,
  prefersMarkdown,
} from "./serve.js";
