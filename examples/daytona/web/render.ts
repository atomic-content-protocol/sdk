/**
 * Results markup. Shared `scaleRow` and `breakEven` so a chosen N matches
 * the Node bench's fork curve.
 */

import { breakEven, type PromptArm, type QuestionMeasurement, type ScaleRow, scaleRow, usd } from "../src/score.js";

export interface BenchView {
  sourceLabel: string;
  perQuestion: QuestionMeasurement[];
  prompt?: (id: string, arm: PromptArm) => string;
  enrichment: {
    measuredInput: number;
    estimatedOutput: number;
    packageUsd: number;
    modeledUsd: number;
  };
  matchNote: string;
  recorded: boolean;
}

const ARMS: Array<{ arm: PromptArm; label: string }> = [
  { arm: "naive", label: "Naive full-read" },
  { arm: "search", label: "Search-then-read" },
  { arm: "summary-decision", label: "Summary-first decision prompt" },
  { arm: "summary-body", label: "Summary-first opened markdown" },
  { arm: "legacy", label: "Legacy ACP" },
];

const COLORS = [
  { key: "baseline_tokens" as const, className: "naive", label: "Naive" },
  { key: "search_tokens" as const, className: "search", label: "Search" },
  { key: "acp_tokens" as const, className: "summary", label: "Summary-first" },
  { key: "legacy_tokens" as const, className: "legacy", label: "Legacy" },
];

function int(value: number): string {
  return value.toLocaleString("en-US");
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function money(tokens: number): string {
  return `$${usd(tokens, 1).toFixed(4)}`;
}

function rate(value: number): string {
  return pct(value * 100);
}

function forks(count: number | null): string {
  if (count === null) return "not reached within 100,000 forks";
  return count === 1 ? "1 fork" : `${count} forks`;
}

function yn(flag: boolean): string {
  return flag ? "yes" : "no";
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function table(headers: string[], rows: string[][]): HTMLElement {
  const wrap = el("div", "table-wrap");
  const tableEl = document.createElement("table");
  const head = document.createElement("tr");
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.textContent = header;
    head.append(cell);
  }
  const thead = document.createElement("thead");
  thead.append(head);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const cell = document.createElement("td");
      cell.textContent = value;
      tr.append(cell);
    }
    body.append(tr);
  }
  tableEl.append(thead, body);
  wrap.append(tableEl);
  return wrap;
}

function chart(row: ScaleRow, title: string, keys: Array<(typeof COLORS)[number]>): HTMLElement {
  const section = el("section");
  const heading = el("h2");
  heading.textContent = title;
  section.append(heading);
  const max = Math.max(...keys.map((item) => row[item.key]), 1);
  const grid = el("div", "chart");
  for (const item of keys) {
    const line = el("div", "bar-row");
    const name = el("span");
    name.textContent = item.label;
    const track = el("div", "bar-track");
    const bar = el("div", `bar ${item.className}`);
    bar.style.width = `${(row[item.key] / max) * 100}%`;
    track.append(bar);
    const value = el("span", "bar-value");
    value.textContent = `${int(row[item.key])} (${money(row[item.key])})`;
    line.append(name, track, value);
    grid.append(line);
  }
  section.append(grid);
  return section;
}

function scaleTable(rows: ScaleRow[]): HTMLElement {
  return table(
    [
      "N",
      "Naive tokens",
      "Search tokens",
      "Summary-first",
      "Legacy",
      "Summary vs naive",
      "Summary vs search",
      "Legacy vs search",
      "Naive $",
      "Search $",
      "Summary $",
      "Legacy $",
    ],
    rows.map((row) => [
      String(row.n),
      int(row.baseline_tokens),
      int(row.search_tokens),
      int(row.acp_tokens),
      int(row.legacy_tokens),
      pct(row.percent_saved),
      pct(row.percent_saved_vs_search),
      pct(row.legacy_percent_saved_vs_search),
      money(row.baseline_tokens),
      money(row.search_tokens),
      money(row.acp_tokens),
      money(row.legacy_tokens),
    ])
  );
}

function hitTable(rows: ScaleRow[]): HTMLElement {
  return table(
    [
      "N",
      "Search hit",
      "Summary hit",
      "Legacy hit",
      "Naive answer",
      "Search answer",
      "Summary answer",
      "Legacy answer",
    ],
    rows.map((row) => [
      String(row.n),
      rate(row.search_retrieval_hit_rate),
      rate(row.retrieval_hit_rate),
      rate(row.legacy_retrieval_hit_rate),
      rate(row.baseline_answer_support_rate),
      rate(row.search_answer_support_rate),
      rate(row.acp_answer_support_rate),
      rate(row.legacy_answer_support_rate),
    ])
  );
}

function promptBlock(view: BenchView, row: QuestionMeasurement): HTMLElement {
  const block = el("div");
  const prompt = view.prompt;
  if (!prompt) {
    const note = el("p");
    note.textContent =
      "Prompt text is not in this page. Daytona docs raw text is not bundled, and the docs host does not send Access-Control-Allow-Origin, so this browser cannot fetch the pages and measure them.";
    block.append(note);
    return block;
  }
  for (const arm of ARMS) {
    const armEl = el("div", "arm");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = arm.arm === "naive" ? `Show ${arm.label} (large)` : `Show ${arm.label}`;
    const pre = el("pre", "prompt");
    button.addEventListener("click", () => {
      const text = prompt(row.id, arm.arm);
      pre.textContent =
        arm.arm === "summary-body" && text.length === 0 ? "No markdown body was opened for this question." : text;
      button.disabled = true;
    });
    armEl.append(button, pre);
    block.append(armEl);
  }
  return block;
}

function questionDetails(view: BenchView): HTMLElement {
  const section = el("section");
  const heading = el("h2");
  heading.textContent = "Per question";
  section.append(heading);
  for (const row of view.perQuestion) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${row.id}: ${row.question}`;
    const meta = el("p");
    meta.textContent = `Decision: ${row.decision}. Summary candidates: ${row.candidate_slugs.join(", ") || "(none)"}. Opened: ${row.opened_slugs.join(", ") || "(none)"}. Search opened: ${row.search_opened_slugs.join(", ")}. Legacy opened: ${row.legacy_opened_slugs.join(", ")}. Summary hit ${yn(row.retrieval_hit)}, search hit ${yn(row.search_retrieval_hit)}, summary answer ${yn(row.acp_answer_supported)}, search answer ${yn(row.search_answer_supported)}. Tokens: naive ${int(row.baseline_tokens)}, search ${int(row.search_tokens)}, summary-first ${int(row.acp_tokens)} (decision ${int(row.summary_decision_tokens)} + bodies ${int(row.summary_body_tokens)}), legacy ${int(row.legacy_tokens)}.`;
    details.append(summary, meta, promptBlock(view, row));
    section.append(details);
  }
  return section;
}

export function renderResults(root: HTMLElement, view: BenchView, n: number): void {
  root.replaceChildren();
  const intro = el("p", "match");
  intro.textContent = `${view.sourceLabel} ${view.matchNote}`;
  root.append(intro);

  const sizes = [1, 10, 50, 100];
  if (!sizes.includes(n)) sizes.push(n);
  sizes.sort((a, b) => a - b);
  const rows = sizes.map((size) => scaleRow(view.perQuestion, size, 1));
  const selected = scaleRow(view.perQuestion, n, 1);

  root.append(chart(selected, `Input tokens at N=${n}`, COLORS));
  root.append(
    chart(
      selected,
      `Without the naive upper bound, N=${n}`,
      COLORS.filter((item) => item.key !== "baseline_tokens")
    )
  );

  const tokenHeading = el("h2");
  tokenHeading.textContent = "Tokens and dollars";
  root.append(tokenHeading, scaleTable(rows));

  const hitHeading = el("h2");
  hitHeading.textContent = "Hit rate and answer support";
  root.append(hitHeading, hitTable(rows));

  const savedVsNaive = view.perQuestion.map((row) => row.baseline_tokens - row.acp_tokens);
  const savedVsSearch = view.perQuestion.map((row) => row.search_tokens - row.acp_tokens);
  const legacyVsSearch = view.perQuestion.map((row) => row.search_tokens - row.legacy_tokens);
  const savedUsdVsSearch = savedVsSearch.map((tokens) => usd(tokens, 1));
  const enrich = view.enrichment;
  const lines = [
    `Measured enrichment prompt input tokens: ${int(enrich.measuredInput)}`,
    `Estimated enrichment output tokens: ${int(enrich.estimatedOutput)}`,
    `Package estimateEnrichmentCost total: $${enrich.packageUsd.toFixed(4)}`,
    `Modeled fast-tier USD (measured input at $1/M plus estimated output at $5/M): $${enrich.modeledUsd.toFixed(4)}`,
    `Summary-first break-even vs naive full-read, measured tokens: ${forks(breakEven(savedVsNaive, enrich.measuredInput))}`,
    `Summary-first break-even vs search-then-read, measured tokens: ${forks(breakEven(savedVsSearch, enrich.measuredInput))}`,
    `Summary-first break-even vs search-then-read, modeled USD: ${forks(breakEven(savedUsdVsSearch, enrich.modeledUsd))}`,
    `Legacy catalog break-even vs search-then-read, measured tokens: ${forks(breakEven(legacyVsSearch, enrich.measuredInput))}`,
  ];
  const enrichHeading = el("h2");
  enrichHeading.textContent = "Enrichment, counted once";
  const list = document.createElement("ul");
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  const enrichNote = el("p");
  enrichNote.textContent = view.recorded
    ? "These enrichment totals are the recorded Node measurement. Break-even uses the shared breakEven function on the recorded per-question counts. Metadata model spend for the committed docs corpus is $0."
    : "Enrichment prompt tokens were counted in this browser with js-tiktoken on buildUnifiedPrompt (body truncated to 4000 characters). Estimated output is estimateEnrichmentCost at standard depth, 300 tokens per page. Metadata model spend for the committed Wikipedia corpus is $0.";
  root.append(enrichHeading, list, enrichNote, questionDetails(view));
}
