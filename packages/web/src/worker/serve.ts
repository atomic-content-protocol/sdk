import { type Agent, classifyAgent, isAI, isSearchCrawler } from "./classify.js";

/**
 * Edge serving for ACP. Put it in front of any site: every page also exists as
 * `<path>.md` (an ACO built by `@atomic-content-protocol/web/build`), and this
 * decides who gets which, using only signals agents already send.
 *
 *  1. `GET /about.md`                   → the ACO, to anyone.
 *  2. `Accept: text/markdown` preferred → the ACO. An agent that asks for
 *     Markdown gets ACP without knowing ACP exists.
 *  3. AI agents (assistants fetching for a person, AI crawlers) → the ACO, when
 *     `serveTo` includes them. Same content as the page, a fraction of the tokens.
 *  4. Search crawlers (Googlebot, Bingbot…) and people → the normal page, always.
 *     Search engines must see what people see; serving them anything else is cloaking.
 *
 * Every HTML response also gets `Link: </about.md>; rel="alternate";
 * type="text/markdown"`, so the ACO is discoverable without touching page code.
 */

export const ACO_MEDIA_TYPE = "text/markdown; charset=utf-8";

export interface Hit {
  agent: Agent;
  request: Request;
  response: Response;
  /** Which version went out. */
  served_format: "html" | "aco" | "other";
  /** Why the ACO was served, when it was. */
  acp_reason?: "md_url" | "accept" | "agent";
  /** Whether this page has an ACO at all (false = we couldn't have served one). */
  aco_available: boolean;
}

export interface ACPOptions {
  /** The site itself: the origin, static assets or the framework's handler. */
  fetchPage: (request: Request) => Promise<Response>;
  /**
   * Fetches `<path>.md`. Defaults to `fetchPage` with the `.md` URL, which is
   * right when the ACO files sit next to the pages (static assets).
   */
  fetchACO?: (url: URL, request: Request) => Promise<Response>;
  /**
   * Which agents get the ACO instead of the page without asking for Markdown:
   * "ai" (assistants and AI crawlers, the default), "ai_user" (only assistants
   * fetching for a person) or "none" (only explicit `.md` and Accept requests).
   */
  serveTo?: "ai" | "ai_user" | "none";
  /** Called once per request after the response is chosen. Use it for measurement. */
  onHit?: (hit: Hit) => Promise<void> | void;
  /** Report hits from people too, not only bots. Default false. */
  trackHumans?: boolean;
  /** Defers work past the response (Workers: `ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** The `.md` URL for a page path, or null when the path isn't a page (assets, APIs). */
export function acoPathFor(pathname: string): string | null {
  if (pathname.endsWith(".md")) return pathname;
  if (/^\/(_next|api|cdn-cgi|\.well-known)\//.test(pathname)) return null;
  const last = pathname.split("/").pop() ?? "";
  if (last.includes(".") && !last.endsWith(".html")) return null;
  const trimmed = pathname.replace(/\.html$/, "").replace(/\/+$/, "");
  return `${trimmed || "/index"}.md`;
}

/** True when the client ranks Markdown at least as high as HTML. */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const q = (type: string) => {
    for (const part of accept.split(",")) {
      const [name, ...params] = part.trim().split(";");
      if (name.trim().toLowerCase() !== type) continue;
      const quality = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return quality ? Number.parseFloat(quality.slice(2)) || 0 : 1;
    }
    return -1;
  };
  const markdown = q("text/markdown");
  return markdown > 0 && markdown >= q("text/html");
}

export async function handleWithACP(request: Request, options: ACPOptions): Promise<Response> {
  const agent = classifyAgent(request);
  const url = new URL(request.url);
  const acoPath = request.method === "GET" || request.method === "HEAD" ? acoPathFor(url.pathname) : null;
  const fetchACO =
    options.fetchACO ?? ((acoUrl: URL, original: Request) => options.fetchPage(new Request(acoUrl, original)));

  const report = (hit: Omit<Hit, "agent" | "request">) => {
    if (!options.onHit || (agent.bot_class === "human" && !options.trackHumans)) return;
    const work = Promise.resolve(options.onHit({ agent, request, ...hit })).catch(() => {});
    if (options.waitUntil) options.waitUntil(work);
  };

  // 1. An explicit .md URL.
  if (acoPath && url.pathname.endsWith(".md")) {
    const response = asACO(await fetchACO(url, request), url);
    report({
      response,
      served_format: response.ok ? "aco" : "other",
      acp_reason: "md_url",
      aco_available: response.ok,
    });
    return response;
  }

  // 2 and 3. Markdown asked for, or an AI agent; never a search crawler.
  const reason =
    !acoPath || isSearchCrawler(agent)
      ? undefined
      : prefersMarkdown(request.headers.get("accept"))
        ? "accept"
        : wantsACO(agent, options.serveTo ?? "ai")
          ? "agent"
          : undefined;
  if (acoPath && reason) {
    const acoUrl = new URL(acoPath, url);
    const aco = await fetchACO(acoUrl, request);
    if (aco.ok) {
      const response = asACO(aco, url);
      report({ response, served_format: "aco", acp_reason: reason, aco_available: true });
      return response;
    }
  }

  // 4. The page as people see it, with the ACO advertised.
  const page = await options.fetchPage(request);
  const isHtml = (page.headers.get("content-type") ?? "").includes("text/html");
  const response = isHtml && acoPath ? advertise(page, acoPath) : page;
  report({ response, served_format: isHtml ? "html" : "other", aco_available: Boolean(acoPath && isHtml) });
  return response;
}

function wantsACO(agent: Agent, serveTo: "ai" | "ai_user" | "none") {
  if (serveTo === "none") return false;
  if (serveTo === "ai_user") return agent.bot_class === "ai_user";
  return isAI(agent);
}

/** The ACO response: Markdown type, the page as canonical, and caches keyed on who asked. */
function asACO(aco: Response, pageUrl: URL): Response {
  if (!aco.ok) return aco;
  const headers = new Headers(aco.headers);
  headers.set("content-type", ACO_MEDIA_TYPE);
  const canonical = new URL(pageUrl);
  canonical.pathname = canonical.pathname.replace(/\.md$/, "").replace(/\/index$/, "/") || "/";
  headers.append("link", `<${canonical.href}>; rel="canonical"`);
  headers.set("vary", mergeVary(headers.get("vary"), ["Accept", "User-Agent"]));
  headers.set("x-acp", "aco");
  return new Response(aco.body, { status: aco.status, headers });
}

function advertise(page: Response, acoPath: string): Response {
  const headers = new Headers(page.headers);
  headers.append("link", `<${acoPath}>; rel="alternate"; type="text/markdown"`);
  headers.set("vary", mergeVary(headers.get("vary"), ["Accept", "User-Agent"]));
  return new Response(page.body, { status: page.status, statusText: page.statusText, headers });
}

function mergeVary(existing: string | null, add: string[]): string {
  const values = new Set(
    (existing ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
  for (const value of add) values.add(value);
  return [...values].join(", ");
}
