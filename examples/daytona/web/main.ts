import manifestJson from "../corpus/manifest.json";
import docsBench from "../docs-demo/results/offline.json";
import type { QuestionMeasurement } from "../src/score.js";
import { type BenchView, renderResults } from "./render.js";

interface ManifestEntry {
  title: string;
  source_url: string;
}

const WIKI_CAVEAT =
  "Wikipedia answers sit in the article leads, so this set is easy. On the committed run, all 20 questions were answered from summaries and no body was opened. A question whose answer is only deep in the article would open up to three bodies or fail answer support. N cycles these 20 questions. N=1 is the first question only.";

const DOCS_CAVEAT =
  "The Daytona docs set is 15 questions, cycled when N is larger than 15. This page shows the committed results as read-only. The raw docs text is not bundled. The public docs do not send Access-Control-Allow-Origin, so this page cannot fetch them and measure them in the browser. Counts for a chosen N are scaled from the recorded per-question totals.";

let current: BenchView | null = null;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function corpus(): "wikipedia" | "docs" {
  return byId<HTMLSelectElement>("corpus").value === "docs" ? "docs" : "wikipedia";
}

function nValue(): number {
  const parsed = Number(byId<HTMLInputElement>("n").value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(100, parsed);
}

function setN(value: number): void {
  const clamped = Math.min(100, Math.max(1, value));
  byId<HTMLInputElement>("n").value = String(clamped);
  byId<HTMLInputElement>("n-range").value = String(clamped);
}

function paint(): void {
  if (!current) return;
  renderResults(byId("output"), current, nValue());
}

function docsView(): BenchView {
  const rows = docsBench.per_question as QuestionMeasurement[];
  return {
    sourceLabel: `Recorded Node results for ${docsBench.pages} Daytona docs pages and ${docsBench.questions} questions. Raw docs text is not in this page.`,
    perQuestion: rows,
    enrichment: {
      measuredInput: docsBench.enrichment.measured_prompt_input_tokens,
      estimatedOutput: docsBench.enrichment.estimated_output_tokens,
      packageUsd: docsBench.enrichment.package_estimate_usd,
      modeledUsd: docsBench.enrichment.modeled_usd,
    },
    matchNote:
      "A custom N is scaled from those recorded per-question counts with the same scaleRow function as npm run bench. This is not a new measurement.",
    recorded: true,
  };
}

function showCaveat(): void {
  const docs = corpus() === "docs";
  byId("caveat").textContent = docs ? DOCS_CAVEAT : WIKI_CAVEAT;
  byId<HTMLButtonElement>("run").textContent = docs ? "Show recorded results" : "Run in this browser";
}

function renderArticles(): void {
  const manifest = manifestJson as ManifestEntry[];
  const list = document.createElement("ul");
  for (const entry of manifest) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = entry.source_url;
    link.textContent = entry.title;
    item.append(link);
    list.append(item);
  }
  byId("articles").replaceChildren(list);
}

async function run(): Promise<void> {
  const button = byId<HTMLButtonElement>("run");
  const status = byId("status");
  button.disabled = true;
  try {
    if (corpus() === "docs") {
      current = docsView();
      status.textContent = "Showing recorded docs results.";
    } else {
      status.textContent = "Loading the corpus and tokenizer. The first run can take a minute on a phone.";
      const { runWikipedia } = await import("./wikipedia.js");
      current = await runWikipedia((message) => {
        status.textContent = `${message} The first run can take a minute on a phone.`;
      });
      status.textContent = "Done. Counts below are from this browser.";
    }
    paint();
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
}

byId<HTMLFormElement>("controls").addEventListener("submit", (event) => {
  event.preventDefault();
  void run();
});

byId<HTMLSelectElement>("corpus").addEventListener("change", () => {
  showCaveat();
  current = null;
  byId("output").replaceChildren();
  byId("status").textContent = "";
});

byId<HTMLInputElement>("n-range").addEventListener("input", () => {
  setN(Number(byId<HTMLInputElement>("n-range").value));
  paint();
});

byId<HTMLInputElement>("n").addEventListener("input", () => {
  setN(nValue());
  paint();
});

renderArticles();
showCaveat();
