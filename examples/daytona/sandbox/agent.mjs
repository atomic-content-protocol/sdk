/**
 * Runs inside a Daytona sandbox, or locally for the smoke check.
 *
 * Talks to the local ACP CLI (`acp serve`, stdio MCP). It does not call a
 * hosted ACP service. Model calls are optional: without a key the process
 * still returns the triage decision and sets `error` on each model result.
 *
 * Keep `contentQuery` in sync with src/policy-logic.ts. Both read policy.json.
 *
 * The ACP arm is summary-first. `list_acos` is used only to read frontmatter
 * (title, summary, tags). That catalog is not placed in the model prompt.
 * The offline coverage rule decides which markdown bodies to open. A live
 * model call, when a key is set, receives that same context in one prompt.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bm25Search, searchMaterial, summaryFirst } from "./bm25.mjs";

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
  return { text, data: parsed.data };
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

async function answerQuestion(client, question, pages) {
  const query = contentQuery(question.question, policy.stopwords);
  const prefix = `${policy.instruction}Question: ${question.question}\n\n`;
  const list = await callTool(client, "list_acos", {
    limit: policy.catalog_limit,
    sortBy: "title",
    order: "asc",
  });
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
  const triage = summaryFirst(enriched, question.question, policy.stopwords, {
    summaryK: policy.summary_k,
    maxBodies: policy.max_bodies,
    coverFraction: policy.cover_fraction,
  });
  const decisionPrompt = `${prefix}${triage.summaryMaterial}`;
  const acpPrompt = triage.bodyMaterial.length === 0 ? decisionPrompt : `${decisionPrompt}${triage.bodyMaterial}`;
  const hits = bm25Search(pages, question.question, policy.stopwords, policy.limit);
  const searchPrompt = `${prefix}${searchMaterial(pages, hits, policy.sections)}`;
  const mode = process.env.SMOKE === "1" ? "search" : (process.env.ACP_LIVE_BASELINE ?? "search");
  if (!["search", "naive", "both"].includes(mode)) {
    throw new Error(`ACP_LIVE_BASELINE must be search, naive, or both, got ${mode}`);
  }
  const acp = await callModel(acpPrompt);
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
    candidate_slugs: triage.candidate_slugs,
    opened_slugs: triage.opened_slugs,
    decision: triage.decision,
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
