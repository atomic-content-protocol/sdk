/**
 * Live Daytona run. Creates real sandboxes and, when a model key is set,
 * records only the token usage the provider returns.
 *
 * Requires DAYTONA_API_KEY and ANTHROPIC_API_KEY or OPENAI_API_KEY.
 * If either is missing, exits 0 and does not write numbers.
 *
 * Fork path (preferred): Linux VM snapshot (`SandboxClass.LINUX_VM`) from
 * `node:22-bookworm-slim`, install the ACP CLI in the parent, upload the
 * corpus, `sandbox.createSnapshot`, then `sandbox.fork` once per question.
 * Docs: container sandboxes cannot fork.
 *
 * Fallback: one container snapshot from the Dockerfile, the corpus copied
 * onto a Daytona volume, then N sandboxes created from that snapshot with
 * the volume mounted. The result records which path ran.
 *
 * ACP_LIVE_N (default `1,10,50,100`) selects the rows. The harness runs the
 * largest N once. Smaller rows are prefixes of that sequence.
 *
 * The ACP arm is summary-first: compact summaries, then markdown bodies only
 * when the coverage rule opens them. The model receives that context in one
 * call. The offline benchmark counts the decision prompt and the bodies as
 * two cl100k encodings. Provider usage here is whatever the API returns for
 * the concatenated prompt.
 *
 * ACP_LIVE_BASELINE (default `search`) chooses the non-ACP arm:
 * - `search`: BM25 search-then-read, top 3. This fits a normal context window.
 * - `naive`: full-read of every page. Upper bound. Often rejected by the model.
 * - `both`: search and naive. Naive usage stays empty when the provider rejects it.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { containerImage, SandboxClass, VM_BASE_IMAGE, VOLUME_MOUNT, VOLUME_NAME } from "./image.js";
import { EXAMPLE_ROOT, type Question } from "./policy.js";

interface ModelBlock {
  answer: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  error: string | null;
  prompt_chars: number | null;
  answer_supported: boolean | null;
}

interface QuestionRun {
  id: string;
  sandbox_id: string;
  fork_ms: number;
  agent_ms: number;
  candidate_slugs: string[];
  opened_slugs: string[];
  search_opened_slugs: string[];
  retrieval_hit: boolean | null;
  search_retrieval_hit: boolean | null;
  acp: ModelBlock;
  search: ModelBlock | null;
  naive: ModelBlock | null;
}

interface LiveReport {
  status: "completed" | "partial" | "failed";
  mode: "vm-fork" | "volume-parallel" | null;
  fallback_reason: string | null;
  requested_n: number[];
  ran: number;
  enrich_once_ms: number | null;
  volume: string | null;
  questions: QuestionRun[];
  scale: Array<{
    n: number;
    complete: boolean;
    acp_input_tokens: number | null;
    acp_output_tokens: number | null;
    search_input_tokens: number | null;
    search_output_tokens: number | null;
    naive_input_tokens: number | null;
    naive_output_tokens: number | null;
    retrieval_hit_rate: number | null;
    search_retrieval_hit_rate: number | null;
    acp_answer_support_rate: number | null;
    search_answer_support_rate: number | null;
    naive_answer_support_rate: number | null;
    sum_fork_ms: number;
    sum_agent_ms: number;
  }>;
  error: string | null;
}

function redact(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").slice(0, 1200);
}

function requestedSizes(): number[] {
  const raw = process.env.ACP_LIVE_N ?? "1,10,50,100";
  const sizes = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (sizes.length === 0) throw new Error("ACP_LIVE_N did not contain a positive integer");
  return sizes;
}

function walk(dir: string, remoteRoot: string): Array<{ source: string; destination: string }> {
  const files: Array<{ source: string; destination: string }> = [];
  for (const name of readdirSync(dir)) {
    const source = path.join(dir, name);
    const destination = `${remoteRoot}/${name}`;
    if (statSync(source).isDirectory()) files.push(...walk(source, destination));
    else files.push({ source, destination });
  }
  return files;
}

async function exec(sandbox: Sandbox, command: string, timeout = 120): Promise<string> {
  const response = await sandbox.process.executeCommand(command, "/", undefined, timeout);
  if (response.exitCode !== 0) {
    throw new Error(`${command} exited ${response.exitCode}: ${response.result.slice(0, 800)}`);
  }
  return response.result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function modelBlock(value: unknown, expected: string): ModelBlock {
  const record = asRecord(value);
  if (!record) {
    return {
      answer: null,
      input_tokens: null,
      output_tokens: null,
      latency_ms: null,
      error: "missing model block",
      prompt_chars: null,
      answer_supported: null,
    };
  }
  const usage = asRecord(record["usage"]);
  const input = usage?.["input_tokens"];
  const output = usage?.["output_tokens"];
  const answer = typeof record["answer"] === "string" ? record["answer"] : null;
  const error = typeof record["error"] === "string" ? record["error"] : null;
  return {
    answer: answer === null ? null : answer.slice(0, 4000),
    input_tokens: typeof input === "number" ? input : null,
    output_tokens: typeof output === "number" ? output : null,
    latency_ms: typeof record["latency_ms"] === "number" ? record["latency_ms"] : null,
    error,
    prompt_chars: typeof record["prompt_chars"] === "number" ? record["prompt_chars"] : null,
    answer_supported: answer === null ? null : answer.toLowerCase().includes(expected.toLowerCase()),
  };
}

async function runAgent(
  sandbox: Sandbox,
  question: Question,
  paths: { vault: string; pages: string; manifest: string; questions: string; policy: string; agent: string }
): Promise<QuestionRun> {
  const env: Record<string, string> = {
    PATH: "/opt/acp/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    QUESTION_ID: question.id,
    QUESTION: question.question,
    ACP_VAULT: paths.vault,
    ACP_PAGES: paths.pages,
    ACP_MANIFEST: paths.manifest,
    ACP_QUESTIONS: paths.questions,
    ACP_POLICY: paths.policy,
  };
  env.ACP_LIVE_BASELINE = process.env.ACP_LIVE_BASELINE ?? "search";
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const started = Date.now();
  const response = await sandbox.process.executeCommand(`node ${paths.agent}`, "/", env, 300);
  const agentMs = Date.now() - started;
  if (response.exitCode !== 0 && response.result.trim().length === 0) {
    throw new Error(`agent exited ${response.exitCode} with empty stdout`);
  }
  const line = response.result.trim().split("\n").at(-1) ?? "";
  const parsed = asRecord(JSON.parse(line));
  if (!parsed) throw new Error("agent stdout was not a JSON object");
  if (typeof parsed["error"] === "string" && !Array.isArray(parsed["opened_slugs"])) {
    throw new Error(parsed["error"]);
  }
  const candidates = Array.isArray(parsed["candidate_slugs"]) ? parsed["candidate_slugs"].map(String) : [];
  const opened = Array.isArray(parsed["opened_slugs"]) ? parsed["opened_slugs"].map(String) : [];
  const searchOpened = Array.isArray(parsed["search_opened_slugs"]) ? parsed["search_opened_slugs"].map(String) : [];
  return {
    id: question.id,
    sandbox_id: sandbox.id,
    fork_ms: 0,
    agent_ms: agentMs,
    candidate_slugs: candidates,
    opened_slugs: opened,
    search_opened_slugs: searchOpened,
    retrieval_hit: question.gold_slugs.every((slug) => candidates.includes(slug)),
    search_retrieval_hit: question.gold_slugs.every((slug) => searchOpened.includes(slug)),
    acp: modelBlock(parsed["acp"], question.expected_answer),
    search: parsed["search"] == null ? null : modelBlock(parsed["search"], question.expected_answer),
    naive: parsed["naive"] == null ? null : modelBlock(parsed["naive"], question.expected_answer),
  };
}

function sumIfComplete(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function rate(flags: Array<boolean | null>): number | null {
  if (flags.some((flag) => flag === null)) return null;
  const yes = flags.filter((flag) => flag).length;
  return flags.length === 0 ? null : yes / flags.length;
}

function scaleRows(questions: QuestionRun[], sizes: number[]): LiveReport["scale"] {
  return sizes.map((n) => {
    const slice = questions.slice(0, n);
    const complete = slice.length === n;
    return {
      n,
      complete,
      acp_input_tokens: complete ? sumIfComplete(slice.map((row) => row.acp.input_tokens)) : null,
      acp_output_tokens: complete ? sumIfComplete(slice.map((row) => row.acp.output_tokens)) : null,
      search_input_tokens: complete ? sumIfComplete(slice.map((row) => row.search?.input_tokens ?? null)) : null,
      search_output_tokens: complete ? sumIfComplete(slice.map((row) => row.search?.output_tokens ?? null)) : null,
      naive_input_tokens: complete ? sumIfComplete(slice.map((row) => row.naive?.input_tokens ?? null)) : null,
      naive_output_tokens: complete ? sumIfComplete(slice.map((row) => row.naive?.output_tokens ?? null)) : null,
      retrieval_hit_rate: complete ? rate(slice.map((row) => row.retrieval_hit)) : null,
      search_retrieval_hit_rate: complete ? rate(slice.map((row) => row.search_retrieval_hit)) : null,
      acp_answer_support_rate: complete ? rate(slice.map((row) => row.acp.answer_supported)) : null,
      search_answer_support_rate: complete ? rate(slice.map((row) => row.search?.answer_supported ?? null)) : null,
      naive_answer_support_rate: complete ? rate(slice.map((row) => row.naive?.answer_supported ?? null)) : null,
      sum_fork_ms: slice.reduce((total, row) => total + row.fork_ms, 0),
      sum_agent_ms: slice.reduce((total, row) => total + row.agent_ms, 0),
    };
  });
}

function renderLive(report: LiveReport): string {
  const lines = ["# Live Daytona run", "", `Status: ${report.status}.`, "", `Mode: ${report.mode ?? "none"}.`];
  if (report.fallback_reason) lines.push("", `Fork fallback reason: ${report.fallback_reason}`);
  if (report.error) lines.push("", `Error: ${report.error}`);
  lines.push(
    "",
    "The ACP arm is summary-first. Retrieval hit means the gold page was a summary candidate. The default comparison arm is search-then-read. Naive full-read is an upper bound and is sent only when ACP_LIVE_BASELINE is naive or both.",
    "Token columns are the provider's reported usage. A null means that call did not return usage. Nothing here is estimated.",
    ""
  );
  if (report.questions.length === 0) {
    lines.push("No question finished.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    "| N | Complete | ACP input | ACP output | Search input | Search output | Naive input | Naive output | ACP hit | Search hit | ACP answer | Search answer | Sum fork ms | Sum agent ms |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  );
  for (const row of report.scale) {
    const cell = (value: number | null) => (value === null ? "" : value.toLocaleString("en-US"));
    const rateCell = (value: number | null) => (value === null ? "" : `${(value * 100).toFixed(1)}%`);
    lines.push(
      `| ${row.n} | ${row.complete ? "yes" : "no"} | ${cell(row.acp_input_tokens)} | ${cell(row.acp_output_tokens)} | ${cell(row.search_input_tokens)} | ${cell(row.search_output_tokens)} | ${cell(row.naive_input_tokens)} | ${cell(row.naive_output_tokens)} | ${rateCell(row.retrieval_hit_rate)} | ${rateCell(row.search_retrieval_hit_rate)} | ${rateCell(row.acp_answer_support_rate)} | ${rateCell(row.search_answer_support_rate)} | ${row.sum_fork_ms} | ${row.sum_agent_ms} |`
    );
  }
  lines.push("", "## Per question", "");
  lines.push(
    "| Question | Sandbox | ACP candidates | ACP bodies | Search opened | ACP hit | Search hit | ACP in/out | Search in/out | Naive in/out | ACP error | Search error | Naive error |"
  );
  lines.push("|---|---|---|---|---|---|---|---:|---:|---:|---|---|---|");
  for (const row of report.questions) {
    const pair = (block: ModelBlock | null) =>
      block === null || block.input_tokens === null ? "" : `${block.input_tokens}/${block.output_tokens ?? ""}`;
    lines.push(
      `| ${row.id} | ${row.sandbox_id} | ${row.candidate_slugs.join(", ")} | ${row.opened_slugs.join(", ")} | ${row.search_opened_slugs.join(", ")} | ${row.retrieval_hit ? "yes" : "no"} | ${row.search_retrieval_hit ? "yes" : "no"} | ${pair(row.acp)} | ${pair(row.search)} | ${pair(row.naive)} | ${row.acp.error ?? ""} | ${row.search?.error ?? ""} | ${row.naive?.error ?? ""} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

async function waitReady(daytona: Daytona): Promise<{ id: string; name: string }> {
  const deadline = Date.now() + 120_000;
  let volume = await daytona.volume.get(VOLUME_NAME, true);
  while (volume.state !== "ready") {
    if (volume.state === "error" || Date.now() > deadline) {
      throw new Error(`volume ${VOLUME_NAME} is ${volume.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    volume = await daytona.volume.get(VOLUME_NAME);
  }
  return { id: volume.id, name: volume.name };
}

async function main(): Promise<void> {
  if (!process.env.DAYTONA_API_KEY) {
    console.log("DAYTONA_API_KEY is not set. Live numbers are pending. No sandbox was created.");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log("ANTHROPIC_API_KEY or OPENAI_API_KEY is not set. Live numbers are pending. No sandbox was created.");
    return;
  }

  const sizes = requestedSizes();
  const largest = Math.max(...sizes);
  const questions = JSON.parse(readFileSync(path.join(EXAMPLE_ROOT, "corpus", "questions.json"), "utf8")) as Question[];
  const assigned = Array.from({ length: largest }, (_, index) => questions[index % questions.length] as Question);
  const stamp = Date.now().toString(36);
  const daytona = new Daytona();
  const created: Sandbox[] = [];
  const snapshotNames: string[] = [];
  const report: LiveReport = {
    status: "failed",
    mode: null,
    fallback_reason: null,
    requested_n: sizes,
    ran: 0,
    enrich_once_ms: null,
    volume: null,
    questions: [],
    scale: [],
    error: null,
  };

  const imagePaths = {
    vault: "/opt/acp/vault",
    pages: "/opt/acp/pages",
    manifest: "/opt/acp/manifest.json",
    questions: "/opt/acp/questions.json",
    policy: "/opt/acp/policy.json",
    agent: "/opt/acp/agent.mjs",
  };
  const volumePaths = {
    vault: `${VOLUME_MOUNT}/vault`,
    pages: `${VOLUME_MOUNT}/pages`,
    manifest: `${VOLUME_MOUNT}/manifest.json`,
    questions: `${VOLUME_MOUNT}/questions.json`,
    policy: `${VOLUME_MOUNT}/policy.json`,
    agent: `${VOLUME_MOUNT}/agent.mjs`,
  };

  try {
    const enrichStarted = Date.now();
    const volume = await waitReady(daytona);
    report.volume = volume.name;
    const containerName = `acp-container-${stamp}`;
    snapshotNames.push(containerName);
    process.stderr.write(`building container snapshot ${containerName}\n`);
    const containerSnapshot = await daytona.snapshot.create(
      { name: containerName, image: containerImage() },
      { onLogs: (chunk) => process.stderr.write(chunk), timeout: 0 }
    );
    const seeder = await daytona.create(
      {
        name: `acp-seed-${stamp}`,
        snapshot: containerSnapshot.name,
        volumes: [{ volumeId: volume.id, mountPath: VOLUME_MOUNT }],
        autoStopInterval: 15,
        ttlMinutes: 60,
        language: "typescript",
        labels: { project: "acp-daytona-benchmark", role: "seed" },
      },
      { timeout: 0 }
    );
    created.push(seeder);
    await exec(
      seeder,
      `mkdir -p ${VOLUME_MOUNT}/vault ${VOLUME_MOUNT}/pages && cp -a /opt/acp/vault/. ${VOLUME_MOUNT}/vault/ && cp -a /opt/acp/pages/. ${VOLUME_MOUNT}/pages/ && cp /opt/acp/manifest.json /opt/acp/questions.json /opt/acp/policy.json /opt/acp/agent.mjs /opt/acp/bm25.mjs ${VOLUME_MOUNT}/`
    );
    report.enrich_once_ms = Date.now() - enrichStarted;

    let parent: Sandbox | null = null;
    try {
      const vmName = `acp-vmbase-${stamp}`;
      snapshotNames.push(vmName);
      process.stderr.write(`building linux-vm snapshot ${vmName}\n`);
      const vmSnapshot = await daytona.snapshot.create(
        { name: vmName, image: VM_BASE_IMAGE, sandboxClass: SandboxClass.LINUX_VM },
        { onLogs: (chunk) => process.stderr.write(chunk), timeout: 0 }
      );
      parent = await daytona.create(
        {
          name: `acp-parent-${stamp}`,
          snapshot: vmSnapshot.name,
          autoStopInterval: 30,
          ttlMinutes: 90,
          language: "typescript",
          labels: { project: "acp-daytona-benchmark", role: "parent" },
        },
        { timeout: 0 }
      );
      created.push(parent);
      await exec(parent, "npm install -g @atomic-content-protocol/cli@0.3.2", 0);
      await exec(parent, "mkdir -p /opt/acp/vault /opt/acp/pages");
      const uploads = [
        ...walk(path.join(EXAMPLE_ROOT, "corpus", "vault"), "/opt/acp/vault"),
        ...walk(path.join(EXAMPLE_ROOT, "corpus", "pages"), "/opt/acp/pages"),
        { source: path.join(EXAMPLE_ROOT, "corpus", "manifest.json"), destination: "/opt/acp/manifest.json" },
        { source: path.join(EXAMPLE_ROOT, "corpus", "questions.json"), destination: "/opt/acp/questions.json" },
        { source: path.join(EXAMPLE_ROOT, "policy.json"), destination: "/opt/acp/policy.json" },
        { source: path.join(EXAMPLE_ROOT, "sandbox", "agent.mjs"), destination: "/opt/acp/agent.mjs" },
        { source: path.join(EXAMPLE_ROOT, "sandbox", "bm25.mjs"), destination: "/opt/acp/bm25.mjs" },
      ];
      await parent.fs.uploadFiles(uploads);
      const enriched = `acp-enriched-${stamp}`;
      snapshotNames.push(enriched);
      await parent.createSnapshot(enriched, 0);
      report.mode = "vm-fork";
    } catch (err) {
      report.fallback_reason = redact(err);
      report.mode = "volume-parallel";
      process.stderr.write(`vm fork unavailable, using volume parallel: ${report.fallback_reason}\n`);
    }

    const concurrency = 4;
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < assigned.length) {
        const index = cursor;
        cursor += 1;
        const question = assigned[index];
        if (!question) return;
        const forkStarted = Date.now();
        let sandbox: Sandbox;
        if (report.mode === "vm-fork" && parent) {
          sandbox = await parent.fork({ name: `acp-fork-${stamp}-${index}` }, 180);
        } else {
          sandbox = await daytona.create(
            {
              name: `acp-par-${stamp}-${index}`,
              snapshot: containerName,
              volumes: [{ volumeId: volume.id, mountPath: VOLUME_MOUNT }],
              autoStopInterval: 15,
              ttlMinutes: 60,
              language: "typescript",
              labels: { project: "acp-daytona-benchmark", role: "parallel" },
            },
            { timeout: 0 }
          );
        }
        created.push(sandbox);
        const forkMs = Date.now() - forkStarted;
        const paths = report.mode === "vm-fork" ? imagePaths : volumePaths;
        const row = await runAgent(sandbox, question, paths);
        row.fork_ms = forkMs;
        report.questions[index] = row;
        report.ran += 1;
        await daytona.delete(sandbox, 60).catch((err: unknown) => {
          process.stderr.write(`delete ${sandbox.id} failed: ${redact(err)}\n`);
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, assigned.length) }, () => worker()));
    const finished = report.questions.filter((row) => row !== undefined);
    report.questions = finished;
    report.scale = scaleRows(finished, sizes);
    const full = finished.length === assigned.length;
    report.status = full ? "completed" : "partial";
    if (!full) report.error = `finished ${finished.length} of ${assigned.length} questions`;
  } catch (err) {
    report.status = report.questions.length > 0 ? "partial" : "failed";
    report.error = redact(err);
    report.scale = scaleRows(
      report.questions.filter((row) => row !== undefined),
      sizes
    );
  } finally {
    for (const sandbox of created) {
      await daytona.delete(sandbox, 60).catch(() => undefined);
    }
    for (const name of snapshotNames) {
      await daytona.snapshot.delete(name).catch(() => undefined);
    }
    const resultsDir = path.join(EXAMPLE_ROOT, "results");
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(path.join(resultsDir, "live.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(path.join(resultsDir, "live.md"), renderLive(report));
    console.log(`live status ${report.status} mode ${report.mode ?? "none"} ran ${report.ran}`);
    if (report.status !== "completed") process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(redact(err));
  process.exit(1);
});
