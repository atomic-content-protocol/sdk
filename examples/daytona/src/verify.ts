/**
 * Checks the committed corpus and that a fresh measurement matches results/offline.json.
 * Also runs the sandbox agent against the local `acp serve` and checks it opens
 * the same pages as the in-process MCP call.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FilesystemAdapter, validateACO } from "@atomic-content-protocol/core";
import { measureCorpus } from "./measure.js";
import { contentQuery, EXAMPLE_ROOT, loadPolicy, type Question } from "./policy.js";

function fail(message: string): never {
  throw new Error(message);
}

async function smoke(expected: Map<string, string[]>): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SMOKE: "1",
    ACP_VAULT: path.join(EXAMPLE_ROOT, "corpus", "vault"),
    ACP_PAGES: path.join(EXAMPLE_ROOT, "corpus", "pages"),
    ACP_MANIFEST: path.join(EXAMPLE_ROOT, "corpus", "manifest.json"),
    ACP_QUESTIONS: path.join(EXAMPLE_ROOT, "corpus", "questions.json"),
    ACP_POLICY: path.join(EXAMPLE_ROOT, "policy.json"),
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  const child = spawn("node", [path.join(EXAMPLE_ROOT, "sandbox", "agent.mjs")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => resolve(status ?? 1));
  });
  if (code !== 0) fail(`agent smoke exited ${code}: ${stderr.slice(0, 500)} ${stdout.slice(0, 500)}`);
  const rows = JSON.parse(stdout) as Array<{ question_id: string; opened_slugs: string[]; method: string }>;
  if (rows.length !== expected.size) fail(`smoke returned ${rows.length} rows, expected ${expected.size}`);
  for (const row of rows) {
    if (row.method !== "content_overlap") fail(`${row.question_id} smoke method ${row.method}`);
    const want = expected.get(row.question_id);
    if (!want) fail(`unexpected smoke question ${row.question_id}`);
    if (want.join(",") !== row.opened_slugs.join(",")) {
      fail(`${row.question_id} smoke opened ${row.opened_slugs.join(",")} but measure opened ${want.join(",")}`);
    }
  }
}

async function main(): Promise<void> {
  const policy = loadPolicy();
  if (policy.name !== "mcp-find-similar-top3" || policy.limit !== 3) {
    fail(`policy changed: ${policy.name} limit ${policy.limit}`);
  }
  const questions = JSON.parse(readFileSync(path.join(EXAMPLE_ROOT, "corpus", "questions.json"), "utf8")) as Question[];
  const manifest = JSON.parse(readFileSync(path.join(EXAMPLE_ROOT, "corpus", "manifest.json"), "utf8")) as Array<{
    slug: string;
  }>;
  if (manifest.length !== 50) fail(`expected 50 pages, found ${manifest.length}`);
  if (questions.length !== 20) fail(`expected 20 questions, found ${questions.length}`);

  const storage = new FilesystemAdapter(path.join(EXAMPLE_ROOT, "corpus", "vault"));
  const acos = await storage.listACOs({ limit: 100, sortBy: "title", order: "asc" });
  if (acos.length !== 50) fail(`vault has ${acos.length} ACOs`);
  const bodyBySlug = new Map<string, string>();
  for (const aco of acos) {
    const validation = validateACO(aco.frontmatter);
    if (!validation.valid) fail(`invalid ACO ${JSON.stringify(validation.errors)}`);
    const slug = String(aco.frontmatter["corpus_slug"]);
    bodyBySlug.set(slug, aco.body);
    const cached = readFileSync(path.join(EXAMPLE_ROOT, "corpus", "pages", `${slug}.txt`), "utf8").replace(/\n$/, "");
    if (cached !== aco.body) fail(`${slug} page cache does not match the ACO body`);
  }
  for (const question of questions) {
    if (contentQuery(question.question, policy.stopwords).length === 0) fail(`${question.id} has no content words`);
    for (const slug of question.gold_slugs) {
      const body = bodyBySlug.get(slug);
      if (!body) fail(`${question.id} gold slug ${slug} missing`);
      if (!body.toLowerCase().includes(question.expected_answer.toLowerCase())) {
        fail(`${question.id} expected answer is not in ${slug}`);
      }
    }
  }

  const fresh = await measureCorpus();
  const committed = JSON.parse(readFileSync(path.join(EXAMPLE_ROOT, "results", "offline.json"), "utf8")) as {
    per_question: Array<{
      id: string;
      baseline_tokens: number;
      acp_tokens: number;
      opened_slugs: string[];
      retrieval_hit: boolean;
    }>;
    enrichment: { measured_prompt_input_tokens: number; measured_token_break_even_forks: number | null };
    scale: Array<{ n: number; baseline_tokens: number; acp_tokens: number }>;
  };
  if (fresh.per_question.length !== committed.per_question.length) fail("question count drift");
  for (let i = 0; i < fresh.per_question.length; i++) {
    const next = fresh.per_question[i];
    const prev = committed.per_question[i];
    if (!next || !prev) fail("missing question row");
    if (
      next.id !== prev.id ||
      next.baseline_tokens !== prev.baseline_tokens ||
      next.acp_tokens !== prev.acp_tokens ||
      next.retrieval_hit !== prev.retrieval_hit ||
      next.opened_slugs.join(",") !== prev.opened_slugs.join(",")
    ) {
      fail(`offline.json is stale at ${next.id}. Rerun npm run measure.`);
    }
  }
  if (fresh.enrichment.measured_prompt_input_tokens !== committed.enrichment.measured_prompt_input_tokens) {
    fail("enrichment token count drifted");
  }
  for (let i = 0; i < fresh.scale.length; i++) {
    const next = fresh.scale[i];
    const prev = committed.scale[i];
    if (
      !next ||
      !prev ||
      next.n !== prev.n ||
      next.baseline_tokens !== prev.baseline_tokens ||
      next.acp_tokens !== prev.acp_tokens
    ) {
      fail("scale table drifted");
    }
  }

  const live = readFileSync(path.join(EXAMPLE_ROOT, "results", "live.md"), "utf8");
  const liveJsonPath = path.join(EXAMPLE_ROOT, "results", "live.json");
  let liveJson: { status?: string } | null = null;
  try {
    liveJson = JSON.parse(readFileSync(liveJsonPath, "utf8")) as { status?: string };
  } catch {
    liveJson = null;
  }
  if (liveJson?.status === "completed" || liveJson?.status === "partial" || liveJson?.status === "failed") {
    if (!live.includes("Live Daytona run")) fail("live.md missing heading");
  } else if (!live.includes("Status: pending")) {
    fail("live.md must say pending until a real live run writes results/live.json");
  }

  await smoke(new Map(fresh.per_question.map((row) => [row.id, row.opened_slugs])));
  console.log("verify ok");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
