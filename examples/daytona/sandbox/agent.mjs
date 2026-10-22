/**
 * Runs inside a Daytona sandbox, or locally for the smoke check.
 *
 * Talks to the local ACP CLI (`acp serve`, stdio MCP). It does not call a
 * hosted ACP service. Model calls are optional: without a key the process
 * still returns the triage decision and sets `error` on each model result.
 *
 * Keep `contentQuery` in sync with src/policy-logic.ts. Both read policy.json.
 *
 * The ACP arm defaults to summary-first. `list_acos` is used only to read
 * frontmatter (title, summary, tags). That catalog is not placed in the model
 * prompt.
 *
 * ACP_LIVE_POLICY=summary-first (default) shows the top 3 summaries and lets
 * the model answer or reply `OPEN slug`. Uncertain replies open the top body,
 * or the top 2 when the scores are close, and never more than 2. A second
 * call then answers from those pages.
 * ACP_LIVE_POLICY=summary-first-v1 keeps the old term-coverage rule in one call.
 * ACP_LIVE_POLICY=legacy uses the catalog prompt. Hit slugs are the pages
 * find_similar opened.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bm25Search, searchMaterial, summaryFirst, summaryFirstV1 } from "./bm25.mjs";

const policy = JSON.parse(readFileSync(process.env.ACP_POLICY ?? "/opt/acp/policy.json", "utf8"));
const vault = process.env.ACP_VAULT ?? "/opt/acp/vault";
const pagesDir = process.env.ACP_PAGES ?? "/opt/acp/pages";
const manifestPath = process.env.ACP_MANIFEST ?? "/opt/acp/manifest.json";
const questionsPath = process.env.ACP_QUESTIONS ?? "/opt/acp/questions.json";

function contentQuery(question, stopwords) {
  const stop = new Set(stopwords);
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !stop.has(word))
    .join(" ");
}

function encode(message) {
  return `${JSON.stringify(message)}\n`;
}

function startServer() {
  const bin = process.env.ACP_BIN ?? "acp";
  const prefix = process.env.ACP_BIN_ARGS ? process.env.ACP_BIN_ARGS.split(" ").filter(Boolean) : [];
  const child = spawn(bin, [...prefix, "--vault", vault, "serve"], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve(message);
      }
    }
  });
  let nextId = 1;
  function request(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, 60_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      child.stdin.write(encode({ jsonrpc: "2.0", id, method, params }));
    });
  }
  function notify(method, params) {
    child.stdin.write(encode({ jsonrpc: "2.0", method, params }));
  }
  return { child, request, notify };
}

async function callTool(client, name, args) {
  const result = await client.request("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no text`);
  const parsed = JSON.parse(text);
  if (!parsed.success) throw new Error(`${name} failed: ${parsed.error ?? "unknown"}`);
  return { text, parsed, data: parsed.data };
}

async function callModel(prompt) {
  const started = Date.now();
  if (process.env.ANTHROPIC_API_KEY) {
    const model = "claude-haiku-4-5";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const raw = await response.text();
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { model, latency_ms: latencyMs, error: `anthropic ${response.status}: ${raw.slice(0, 500)}`, prompt_chars: prompt.length };
    }
    const data = JSON.parse(raw);
    const answer = Array.isArray(data.content) ? data.content.map((block) => block.text ?? "").join("") : "";
    return {
      model: data.model ?? model,
      latency_ms: latencyMs,
      answer,
      prompt_chars: prompt.length,
      usage: {
        input_tokens: data.usage?.input_tokens ?? null,
        output_tokens: data.usage?.output_tokens ?? null,
      },
    };
  }
  if (process.env.OPENAI_API_KEY) {
    const model = "gpt-5.6-luna";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const raw = await response.text();
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { model, latency_ms: latencyMs, error: `openai ${response.status}: ${raw.slice(0, 500)}`, prompt_chars: prompt.length };
    }
    const data = JSON.parse(raw);
    return {
      model: data.model ?? model,
      latency_ms: latencyMs,
      answer: data.choices?.[0]?.message?.content ?? "",
      prompt_chars: prompt.length,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? null,
        output_tokens: data.usage?.completion_tokens ?? null,
      },
    };
  }
  return { error: "no model key", prompt_chars: prompt.length, latency_ms: 0 };
}

function loadPages() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return manifest.map((entry) => {
    const body = readFileSync(path.join(pagesDir, `${entry.slug}.txt`), "utf8").replace(/\n$/, "");
    return { slug: entry.slug, title: entry.title, url: entry.source_url, body };
  });
}

function wire(result) {
  return JSON.stringify(result, null, 2);
}

function combineUsage(first, second) {
  const input = (first.usage?.input_tokens ?? 0) + (second.usage?.input_tokens ?? 0);
  const output = (first.usage?.output_tokens ?? 0) + (second.usage?.output_tokens ?? 0);
  return {
    ...second,
    answer: second.answer ?? first.answer ?? "",
    error: second.error ?? first.error,
    latency_ms: (first.latency_ms ?? 0) + (second.latency_ms ?? 0),
    prompt_chars: (first.prompt_chars ?? 0) + (second.prompt_chars ?? 0),
    usage: { input_tokens: input, output_tokens: output },
  };
}

function parseOpen(answer, candidates) {
  const lines = String(answer ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const openLine = lines.find((line) => /^OPEN\b/i.test(line));
  if (!openLine) {
    if (lines.length === 0) return { kind: "uncertain", slugs: [] };
    if (/^(i don't know|i do not know|not enough|uncertain|unsure)\b/i.test(lines[0])) {
      return { kind: "uncertain", slugs: [] };
    }
    return { kind: "answer", slugs: [] };
  }
  const rest = openLine.replace(/^OPEN\b[:\s]*/i, "");
  const tokens = rest.split(/[^a-z0-9-]+/i).filter(Boolean);
  const slugs = [];
  for (const token of tokens) {
    const match = candidates.find((slug) => slug.toLowerCase() === token.toLowerCase());
    if (match && !slugs.includes(match)) slugs.push(match);
    if (slugs.length === 2) break;
  }
  return { kind: "open", slugs };
}

function markdownBodies(pages, slugs) {
  return slugs
    .map((slug) => {
      const page = pages.find((candidate) => candidate.slug === slug);
      if (!page) throw new Error(`missing page ${slug}`);
      return `# ${page.title}\n\n${page.body}`;
    })
    .join("\n\n");
}

async function answerQuestion(client, question, pages) {
  const query = contentQuery(question.question, policy.stopwords);
  const prefix = `${policy.instruction}Question: ${question.question}\n\n`;
  const acpPolicy = process.env.ACP_LIVE_POLICY ?? "summary-first";
  if (acpPolicy !== "summary-first" && acpPolicy !== "summary-first-v1" && acpPolicy !== "legacy") {
    throw new Error(`ACP_LIVE_POLICY must be summary-first, summary-first-v1, or legacy, got ${acpPolicy}`);
  }
  const list = await callTool(client, "list_acos", {
    limit: policy.catalog_limit,
    sortBy: "title",
    order: "asc",
  });
  let acpPrompt;
  let candidateSlugs;
  let openedSlugs;
  let decision;
  let acpResult = null;
  if (acpPolicy === "legacy") {
    const slugById = new Map();
    for (const item of list.data.items ?? []) {
      slugById.set(String(item.id), String(item.corpus_slug));
    }
    const similar = await callTool(client, "find_similar", {
      text: query,
      limit: policy.limit,
      threshold: policy.threshold,
    });
    if (similar.data.method !== "content_overlap") {
      throw new Error(`find_similar used ${String(similar.data.method)}, expected content_overlap`);
    }
    const results = similar.data.results;
    if (!Array.isArray(results)) throw new Error("find_similar returned no results array");
    const openedIds = results.map((row) => String(row.id));
    const legacySlugs = openedIds.map((id) => {
      const slug = slugById.get(id);
      if (!slug) throw new Error(`find_similar returned unknown id ${id}`);
      return slug;
    });
    const reads = [];
    for (const id of openedIds) reads.push(await callTool(client, "read_aco", { id }));
    acpPrompt = `${prefix}${policy.sections.catalog}${wire(list.parsed)}\n\n${policy.sections.ranking}${wire(similar.parsed)}\n\n${policy.sections.opened}${reads.map((row) => wire(row.parsed)).join("\n\n")}`;
    candidateSlugs = legacySlugs;
    openedSlugs = legacySlugs;
    decision = "legacy";
  } else {
    const metaBySlug = new Map();
    for (const item of list.data.items ?? []) {
      const tags = Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)) : [];
      metaBySlug.set(String(item.corpus_slug), {
        summary: typeof item.summary === "string" ? item.summary : "",
        tags,
      });
    }
    const enriched = pages.map((page) => {
      const meta = metaBySlug.get(page.slug);
      if (!meta) throw new Error(`missing frontmatter for ${page.slug}`);
      return { ...page, summary: meta.summary, tags: meta.tags };
    });
    if (acpPolicy === "summary-first-v1") {
      const triage = summaryFirstV1(enriched, question.question, policy.stopwords, {
        summaryK: policy.summary_k,
        maxBodies: policy.v1_max_bodies,
        coverFraction: policy.cover_fraction,
      });
      const decisionPrompt = `${prefix}${triage.summaryMaterial}`;
      acpPrompt = triage.bodyMaterial.length === 0 ? decisionPrompt : `${decisionPrompt}${triage.bodyMaterial}`;
      candidateSlugs = triage.candidate_slugs;
      openedSlugs = triage.opened_slugs;
      decision = triage.decision;
    } else {
      const triage = summaryFirst(enriched, question.question, policy.stopwords, {
        summaryK: policy.summary_k,
        maxBodies: policy.max_bodies,
        closeScoreRatio: policy.close_score_ratio,
        runnerUpCoverFraction: policy.runner_up_cover_fraction,
      });
      const decisionPrompt = `${prefix}${triage.summaryMaterial}`;
      candidateSlugs = triage.candidate_slugs;
      const first = await callModel(decisionPrompt);
      const parsed = first.error ? { kind: "uncertain", slugs: [] } : parseOpen(first.answer, candidateSlugs);
      if (parsed.kind === "answer") {
        acpPrompt = decisionPrompt;
        openedSlugs = [];
        decision = "answer";
        acpResult = first;
      } else {
        const modelChose = parsed.kind === "open" && parsed.slugs.length > 0;
        const chosen = modelChose ? parsed.slugs : triage.opened_slugs;
        openedSlugs = chosen.slice(0, policy.max_bodies);
        decision = modelChose ? "open" : triage.decision;
        const followUp =
          openedSlugs.length === 0
            ? decisionPrompt
            : `${prefix}${policy.sections.pages}${markdownBodies(pages, openedSlugs)}`;
        acpPrompt = followUp;
        if (first.error || openedSlugs.length === 0) acpResult = first;
        else acpResult = combineUsage(first, await callModel(followUp));
      }
    }
  }
  const hits = bm25Search(pages, question.question, policy.stopwords, policy.limit);
  const searchPrompt = `${prefix}${searchMaterial(pages, hits, policy.sections)}`;
  const mode = process.env.SMOKE === "1" ? "search" : (process.env.ACP_LIVE_BASELINE ?? "search");
  if (!["search", "naive", "both"].includes(mode)) {
    throw new Error(`ACP_LIVE_BASELINE must be search, naive, or both, got ${mode}`);
  }
  const acp = acpResult ?? (await callModel(acpPrompt));
  const search = mode === "naive" ? null : await callModel(searchPrompt);
  const naive =
    mode === "naive" || mode === "both"
      ? await callModel(
          `${prefix}${policy.sections.pages}${pages.map((page) => `# ${page.title}\n\n${page.body}`).join("\n\n")}`
        )
      : null;
  return {
    question_id: question.id,
    content_query: query,
    candidate_slugs: candidateSlugs,
    opened_slugs: openedSlugs,
    decision,
    acp_policy: acpPolicy,
    search_opened_slugs: hits.map((hit) => hit.slug),
    baseline_mode: mode,
    acp,
    search,
    naive,
  };
}

async function main() {
  const client = startServer();
  let exitCode = 0;
  try {
    await client.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "acp-daytona-benchmark", version: "0.0.0" },
    });
    client.notify("notifications/initialized");
    const pages = loadPages();
    const questions = JSON.parse(readFileSync(questionsPath, "utf8"));
    const selected =
      process.env.SMOKE === "1"
        ? questions
        : questions.filter((question) => question.id === process.env.QUESTION_ID);
    const one =
      selected.length > 0
        ? selected
        : [{ id: process.env.QUESTION_ID ?? "adhoc", question: process.env.QUESTION ?? "", expected_answer: "", gold_slugs: [] }];
    const rows = [];
    for (const question of one) rows.push(await answerQuestion(client, question, pages));
    process.stdout.write(`${JSON.stringify(process.env.SMOKE === "1" ? rows : rows[0])}\n`);
  } catch (err) {
    exitCode = 1;
    process.stdout.write(`${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n`);
  } finally {
    client.child.kill();
  }
  process.exit(exitCode);
}

main();
