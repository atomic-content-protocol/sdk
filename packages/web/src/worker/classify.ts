/**
 * Who is asking. The classes and the verified-category map are the ones
 * Stacklist's analytics worker already uses for its `bot_fetch` events, so hits
 * measured here count in the same dashboards with no translation.
 */

export type BotClass =
  | "ai_user"
  | "ai_crawler"
  | "classic_crawler"
  | "seo_bot"
  | "security_bot"
  | "monitoring_bot"
  | "verified_bot"
  | "unclassified"
  | "human";

export interface Agent {
  bot_class: BotClass;
  /** The product name when we recognise it, e.g. "ChatGPT-User". */
  agent_name?: string;
  /** Cloudflare's own verdict, when the request came through Cloudflare. */
  verified_bot_category?: string;
  classification_source: "verified_bot_category" | "user_agent" | "none";
}

/** Cloudflare `verifiedBotCategory` strings (Title Case, multi-word) → bot_class. */
export const VERIFIED_BOT_MAP: Record<string, BotClass> = {
  "AI Assistant": "ai_user",
  "AI Crawler": "ai_crawler",
  "AI Search": "ai_crawler",
  "Search Engine Crawler": "classic_crawler",
  "Search Engine Optimization": "seo_bot",
  Security: "security_bot",
  "Monitoring & Analytics": "monitoring_bot",
};

/**
 * User-agent tokens, for requests Cloudflare didn't verify (or that never went
 * through Cloudflare). Order matters: the first match wins, so the user-fetch
 * agents sit before the crawlers that share a vendor.
 *
 * ai_user  = an assistant fetching a page because a person asked it something.
 * ai_crawler = indexing or training crawls, nobody waiting on the answer.
 */
const USER_AGENT_RULES: [RegExp, BotClass, string][] = [
  [/ChatGPT-User/i, "ai_user", "ChatGPT-User"],
  [/Claude-User/i, "ai_user", "Claude-User"],
  [/Perplexity-User/i, "ai_user", "Perplexity-User"],
  [/MistralAI-User/i, "ai_user", "MistralAI-User"],
  [/DuckAssistBot/i, "ai_user", "DuckAssistBot"],
  [/Google-Agent|Gemini-Deep-Research/i, "ai_user", "Google-Agent"],
  [/GPTBot/i, "ai_crawler", "GPTBot"],
  [/OAI-SearchBot/i, "ai_crawler", "OAI-SearchBot"],
  [/ClaudeBot|anthropic-ai/i, "ai_crawler", "ClaudeBot"],
  [/Claude-SearchBot/i, "ai_crawler", "Claude-SearchBot"],
  [/PerplexityBot/i, "ai_crawler", "PerplexityBot"],
  [/CCBot/i, "ai_crawler", "CCBot"],
  [/Bytespider/i, "ai_crawler", "Bytespider"],
  [/Amazonbot/i, "ai_crawler", "Amazonbot"],
  [/meta-externalagent|FacebookBot/i, "ai_crawler", "Meta"],
  [/cohere-ai/i, "ai_crawler", "cohere-ai"],
  [/Diffbot/i, "ai_crawler", "Diffbot"],
  [/YouBot/i, "ai_crawler", "YouBot"],
  // Huawei's search crawler: Cloudflare sometimes calls it AI, Stacklist counts it as search.
  [/PetalBot/i, "classic_crawler", "PetalBot"],
  [/Googlebot|Google-InspectionTool|GoogleOther/i, "classic_crawler", "Googlebot"],
  [/bingbot|BingPreview/i, "classic_crawler", "Bingbot"],
  [/DuckDuckBot/i, "classic_crawler", "DuckDuckBot"],
  [/YandexBot/i, "classic_crawler", "YandexBot"],
  [/Baiduspider/i, "classic_crawler", "Baiduspider"],
  [/Applebot/i, "classic_crawler", "Applebot"],
  [/AhrefsBot|SemrushBot|MJ12bot|DotBot|rogerbot|Screaming Frog/i, "seo_bot", "SEO tool"],
  [/UptimeRobot|Pingdom|StatusCake|Better ?Uptime/i, "monitoring_bot", "Uptime monitor"],
  // Plain HTTP clients: often an agent's own fetch tool rather than a person.
  [
    /python-requests|python-httpx|aiohttp|node-fetch|undici|axios|Go-http-client|curl\/|Wget|okhttp|libwww/i,
    "unclassified",
    "HTTP client",
  ],
  [/bot\b|crawler|spider|scraper/i, "unclassified", "Other bot"],
];

/** Classifies one request. Cloudflare's verified category wins; then the user agent. */
export function classifyAgent(request: Request): Agent {
  const cf = (request as Request & { cf?: { verifiedBotCategory?: string } }).cf;
  const verified = cf?.verifiedBotCategory || undefined;
  const userAgent = request.headers.get("user-agent") ?? "";
  const named = USER_AGENT_RULES.find(([pattern]) => pattern.test(userAgent));

  if (verified) {
    return {
      bot_class: VERIFIED_BOT_MAP[verified] ?? "verified_bot",
      agent_name: named?.[2],
      verified_bot_category: verified,
      classification_source: "verified_bot_category",
    };
  }
  if (named) return { bot_class: named[1], agent_name: named[2], classification_source: "user_agent" };
  return { bot_class: "human", classification_source: "none" };
}

/** Bots that index for search results. They always get the page people see. */
export const isSearchCrawler = (agent: Agent) => agent.bot_class === "classic_crawler";

/** AI traffic, as Stacklist's dashboards define it. */
export const isAI = (agent: Agent) => agent.bot_class === "ai_user" || agent.bot_class === "ai_crawler";
