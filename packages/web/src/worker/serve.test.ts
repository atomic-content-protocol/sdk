import { describe, expect, it, vi } from "vitest";
import { classifyAgent } from "./classify.js";
import { toEvent } from "./posthog.js";
import { acoPathFor, type Hit, handleWithACP, prefersMarkdown } from "./serve.js";

const UA = {
  chatgptUser:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  gptBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
};

/** A fake site: HTML pages, and ACOs next to them for /about only. */
const site = vi.fn(async (request: Request) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/about.md")
    return new Response("---\ntitle: About\n---\nWe bake bread.", { headers: { "content-type": "text/markdown" } });
  if (pathname.endsWith(".md")) return new Response("not found", { status: 404 });
  if (pathname === "/logo.png") return new Response("png", { headers: { "content-type": "image/png" } });
  return new Response("<html><body>About us</body></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});

const get = (path: string, headers: Record<string, string> = {}, cf?: Record<string, unknown>) => {
  const request = new Request(`https://bakery.test${path}`, { headers });
  if (cf) Object.defineProperty(request, "cf", { value: cf });
  return request;
};

describe("acoPathFor", () => {
  it("maps pages to their .md and skips assets and APIs", () => {
    expect(acoPathFor("/")).toBe("/index.md");
    expect(acoPathFor("/about")).toBe("/about.md");
    expect(acoPathFor("/about/")).toBe("/about.md");
    expect(acoPathFor("/about.html")).toBe("/about.md");
    expect(acoPathFor("/about.md")).toBe("/about.md");
    expect(acoPathFor("/logo.png")).toBeNull();
    expect(acoPathFor("/_next/static/chunk.js")).toBeNull();
    expect(acoPathFor("/api/order")).toBeNull();
  });
});

describe("prefersMarkdown", () => {
  it("honours quality values", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
    expect(prefersMarkdown("text/html, text/markdown;q=0.5")).toBe(false);
    expect(prefersMarkdown("text/html,application/xhtml+xml,*/*;q=0.8")).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });
});

describe("classifyAgent", () => {
  it("trusts Cloudflare's verified category first, with Stacklist's classes", () => {
    expect(
      classifyAgent(get("/", { "user-agent": UA.chrome }, { verifiedBotCategory: "AI Assistant" })).bot_class
    ).toBe("ai_user");
    expect(classifyAgent(get("/", {}, { verifiedBotCategory: "Page Preview" })).bot_class).toBe("verified_bot");
  });
  it("falls back to the user agent", () => {
    expect(classifyAgent(get("/", { "user-agent": UA.chatgptUser })).bot_class).toBe("ai_user");
    expect(classifyAgent(get("/", { "user-agent": UA.gptBot })).bot_class).toBe("ai_crawler");
    expect(classifyAgent(get("/", { "user-agent": UA.googlebot })).bot_class).toBe("classic_crawler");
    expect(classifyAgent(get("/", { "user-agent": UA.chrome })).bot_class).toBe("human");
  });
});

describe("handleWithACP", () => {
  const run = async (request: Request, serveTo?: "ai" | "ai_user" | "none") => {
    const hits: Hit[] = [];
    const response = await handleWithACP(request, {
      fetchPage: site,
      serveTo,
      onHit: (h) => void hits.push(h),
      trackHumans: true,
    });
    return { response, hit: hits[0], body: await response.text() };
  };

  it("gives people the page, advertising the ACO", async () => {
    const { response, hit, body } = await run(get("/about", { "user-agent": UA.chrome }));
    expect(body).toContain("<html>");
    expect(response.headers.get("link")).toBe('</about.md>; rel="alternate"; type="text/markdown"');
    expect(hit.served_format).toBe("html");
  });

  it("never gives search crawlers anything but the page", async () => {
    const { body, hit } = await run(get("/about", { "user-agent": UA.googlebot, accept: "text/markdown" }));
    expect(body).toContain("<html>");
    expect(hit.served_format).toBe("html");
  });

  it("gives AI agents the ACO", async () => {
    const { response, body, hit } = await run(get("/about", { "user-agent": UA.chatgptUser }));
    expect(body).toContain("We bake bread.");
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("link")).toContain('rel="canonical"');
    expect(hit).toMatchObject({ served_format: "aco", acp_reason: "agent" });
  });

  it("gives the ACO to anyone who prefers Markdown, even unknown clients", async () => {
    const { body, hit } = await run(get("/about", { "user-agent": "my-agent/0.1", accept: "text/markdown" }));
    expect(body).toContain("We bake bread.");
    expect(hit.acp_reason).toBe("accept");
  });

  it("respects serveTo", async () => {
    expect((await run(get("/about", { "user-agent": UA.gptBot }), "ai_user")).hit.served_format).toBe("html");
    expect((await run(get("/about", { "user-agent": UA.chatgptUser }), "none")).hit.served_format).toBe("html");
  });

  it("falls back to the page when a page has no ACO", async () => {
    const { body, hit } = await run(get("/contact", { "user-agent": UA.chatgptUser }));
    expect(body).toContain("<html>");
    expect(hit.served_format).toBe("html");
  });

  it("serves .md URLs directly and leaves assets alone", async () => {
    expect((await run(get("/about.md", { "user-agent": UA.chrome }))).hit).toMatchObject({
      served_format: "aco",
      acp_reason: "md_url",
    });
    const asset = await run(get("/logo.png", { "user-agent": UA.gptBot }));
    expect(asset.response.headers.get("link")).toBeNull();
    expect(asset.hit.served_format).toBe("other");
  });

  it("never relabels an SPA host's HTML fallback as an ACO", async () => {
    const spa = async () =>
      new Response("<html>app shell</html>", { headers: { "content-type": "Text/HTML; charset=utf-8" } });
    const hits: Hit[] = [];
    const agent = await handleWithACP(get("/contact", { "user-agent": UA.chatgptUser }), {
      fetchPage: spa,
      onHit: (h) => void hits.push(h),
    });
    expect(agent.headers.get("content-type")?.toLowerCase()).toContain("text/html");
    expect(hits[0]).toMatchObject({ served_format: "html", aco_available: false });
    const direct = await handleWithACP(get("/contact.md", { "user-agent": UA.chatgptUser }), { fetchPage: spa });
    expect(direct.status).toBe(404);
  });

  it("only claims an ACO exists after finding it", async () => {
    const { hit } = await run(get("/about", { "user-agent": UA.chrome }));
    expect(hit.aco_available).toBeUndefined();
  });

  it("treats dot segments as not a page", () => {
    expect(acoPathFor("/a/../../etc/passwd")).toBeNull();
  });

  it("doesn't report people unless asked", async () => {
    const onHit = vi.fn();
    await handleWithACP(get("/about", { "user-agent": UA.chrome }), { fetchPage: site, onHit });
    expect(onHit).not.toHaveBeenCalled();
  });
});

describe("toEvent", () => {
  it("is a bot_fetch event with Stacklist's property names plus ACP fields", async () => {
    const request = get("/about", { "user-agent": UA.chatgptUser });
    const response = await handleWithACP(request, { fetchPage: site });
    const event = toEvent(
      {
        agent: classifyAgent(request),
        request,
        response,
        served_format: "aco",
        acp_reason: "agent",
        aco_available: true,
      },
      { site: "bakery.test" }
    );
    expect(event.event).toBe("bot_fetch");
    expect(event.distinct_id).toBe("bot:ChatGPT-User");
    expect(event.properties).toMatchObject({
      path: "/about",
      bot_class: "ai_user",
      classification_source: "user_agent",
      served_format: "aco",
      site: "bakery.test",
      $process_person_profile: false,
    });
  });
});
