import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseACO, validateACO } from "@atomic-content-protocol/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSiteACOs, MANIFEST_PATH, pagesFromSitemap, type SitePage } from "./index.js";

const story = (extra = "") =>
  `Harbor Bakery has baked sourdough on the harbour front since 1987. ${extra}` +
  "We open at seven every morning, Tuesday to Sunday, and close when the bread runs out. ".repeat(8) +
  "Call us on +385 1 234 5678 to order a cake for a birthday or a wedding.";

/** Shaped like a real builder page: framework scripts, inline styles, utility classes. */
const bloat =
  `<script>${'self.__next_f.push([1,"chunk-data"]);'.repeat(60)}</script>` +
  `<style>${".c{display:flex;align-items:center;justify-content:space-between}".repeat(40)}</style>`;
const page = (title: string, text: string): string =>
  `<html><head><title>${title}</title><script>var x=1</script>${bloat}</head>` +
  `<body><nav><a href="/">Home</a><a href="/about">About</a></nav><main><article><h1>${title}</h1><p>${text}</p></article></main>` +
  `<footer>© Harbor Bakery</footer></body></html>`;

const author = { id: "harborbakery.test", name: "Harbor Bakery" };

describe("buildSiteACOs", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "acp-web-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const build = (pages: SitePage[]) =>
    buildSiteACOs({ pages, origin: "https://harborbakery.test", outDir: dir, author, enrich: false });

  it("writes a conformant ACO per page, the card way, and a manifest with token costs", async () => {
    const manifest = await build([
      { path: "/", html: page("Harbor Bakery", story()) },
      { path: "/thin", html: page("Thin", "Hi.") },
    ]);

    const aco = parseACO(await readFile(path.join(dir, "index.md"), "utf8"));
    expect(validateACO(aco.frontmatter).valid).toBe(true);
    expect(aco.frontmatter).toMatchObject({
      object_type: "aco",
      source_type: "link",
      status: "final",
      visibility: "public",
      agent_accessible: true,
      source_url: "https://harborbakery.test/",
      title: "Harbor Bakery",
    });
    expect(aco.body).toContain("+385 1 234 5678");
    expect(aco.body).not.toContain("var x=1");

    expect(manifest.pages).toHaveLength(1);
    expect(manifest.skipped).toEqual([{ path: "/thin", reason: "too little readable text" }]);
    expect(manifest.pages[0].tokens.aco).toBeLessThan(manifest.pages[0].tokens.html);
    expect(JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), "utf8")).site).toBe("https://harborbakery.test");
    expect(await readFile(path.join(dir, "llms.txt"), "utf8")).toContain("https://harborbakery.test/index.md");
  });

  it("keeps a page's identity across rebuilds and only touches what changed", async () => {
    const first = await build([{ path: "/", html: page("Harbor Bakery", story()) }]);
    const firstAco = parseACO(await readFile(path.join(dir, "index.md"), "utf8"));

    const same = await build([{ path: "/", html: page("Harbor Bakery", story()) }]);
    expect(same.pages[0]).toMatchObject({ status: "unchanged", id: first.pages[0].id });

    const changed = await build([{ path: "/", html: page("Harbor Bakery", story("Now with gluten-free loaves.")) }]);
    const changedAco = parseACO(await readFile(path.join(dir, "index.md"), "utf8"));
    expect(changed.pages[0]).toMatchObject({ status: "changed", id: first.pages[0].id });
    expect(changedAco.frontmatter.created).toBe(firstAco.frontmatter.created);
    expect(changedAco.frontmatter.modified).toBeTypeOf("string");
    expect(changedAco.body).toContain("gluten-free");
  });

  it("rebuilds when only the title changes", async () => {
    await build([{ path: "/", html: page("Harbor Bakery", story()) }]);
    const renamed = await build([{ path: "/", html: page("Harbor Bakery & Café", story()) }]);
    expect(renamed.pages[0].status).toBe("changed");
    expect(parseACO(await readFile(path.join(dir, "index.md"), "utf8")).frontmatter.title).toBe("Harbor Bakery & Café");
  });

  it("removes the ACO of a page that is gone, and never writes outside outDir", async () => {
    await build([
      { path: "/", html: page("Harbor Bakery", story()) },
      { path: "/menu", html: page("Menu", story("Croissants every day.")) },
    ]);
    await access(path.join(dir, "menu.md"));
    const after = await build([
      { path: "/", html: page("Harbor Bakery", story()) },
      { path: "/../escape", html: page("Escape", story()) },
    ]);
    await expect(access(path.join(dir, "menu.md"))).rejects.toThrow();
    expect(after.pages.map((p) => p.path)).toEqual(["/"]);
    await expect(access(path.join(dir, "..", "escape.md"))).rejects.toThrow();
  });
});

describe("pagesFromSitemap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips bad entries, resolves relative ones and reads pages from the given base", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      if (url.endsWith("/sitemap.xml"))
        return new Response(
          "<urlset><url><loc>https://live.test/</loc></url><url><loc>/about?x=1&amp;y=2</loc></url><url><loc>http://[bad</loc></url></urlset>"
        );
      return new Response("<html>ok</html>", { headers: { "content-type": "text/html" } });
    });
    const pages = [];
    for await (const p of pagesFromSitemap("http://localhost:3000")) pages.push(p.path);
    expect(pages).toEqual(["/", "/about"]);
    expect(fetched).toContain("http://localhost:3000/about");
  });
});
