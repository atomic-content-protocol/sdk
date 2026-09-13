import { BatchEnricher } from "@atomic-content-protocol/enrichment";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import ora from "ora";
import { loadConfig } from "../utils/config.js";
import { buildPipelines, createRouter, estimateModel, parsePipelines, planBatch } from "../utils/enrichment.js";
import { CliError, EXIT } from "../utils/errors.js";
import { TOOL } from "../utils/pkg.js";
import { confirm } from "../utils/prompt.js";
import { createStorage } from "../utils/storage.js";

function parseUsd(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError("Expected a non-negative USD amount.");
  return n;
}

function parseConcurrency(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 16) throw new InvalidArgumentError("Expected an integer between 1 and 16.");
  return n;
}

interface BatchOptions {
  pipelines: string;
  force: boolean;
  filterTags?: string;
  filterStatus?: string;
  yes: boolean;
  maxCost?: number;
  concurrency: number;
  json: boolean;
}

export const enrichBatchCommand = new Command("enrich-batch")
  .description("Enrich every ACO in the vault (or a filtered subset)")
  .option(
    "-p, --pipelines <names>",
    "Comma-separated pipelines: tag, summary, entity, classification, unified, embed",
    "unified"
  )
  .option("-f, --force", "Regenerate fields that already have values", false)
  .option("--filter-tags <tags>", "Only ACOs with at least one of these tags (comma-separated)")
  .option("--filter-status <status>", "Only ACOs with this status (draft | final | archived)")
  .option("-y, --yes", "Skip the confirmation prompt", false)
  .option(
    "--max-cost <usd>",
    "Only enrich as many ACOs as fit within this estimated budget; nothing beyond it is sent to a provider",
    parseUsd
  )
  .option("-c, --concurrency <n>", "ACOs to enrich in parallel (1-16)", parseConcurrency, 1)
  .option("--json", "Print a machine-readable summary", false)
  .action(async (options: BatchOptions, cmd: Command) => {
    const pipelineNames = parsePipelines(options.pipelines);
    const { config } = await loadConfig(cmd.optsWithGlobals()["vault"] as string | undefined);
    const storage = createStorage(config);
    const router = createRouter(config);

    const spinner = options.json ? null : ora("Scanning vault...").start();

    const query: { tags?: string[]; status?: string[] } = {};
    if (options.filterTags)
      query.tags = options.filterTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    if (options.filterStatus) {
      const status = options.filterStatus.trim();
      if (!["draft", "final", "archived"].includes(status)) {
        spinner?.stop();
        throw new CliError(`Invalid --filter-status "${status}"`, EXIT.USAGE, "Valid values: draft, final, archived");
      }
      query.status = [status];
    }

    const acos = Object.keys(query).length > 0 ? await storage.queryACOs(query) : await storage.listACOs();
    spinner?.succeed(`Found ${acos.length} ACOs`);

    if (acos.length === 0) {
      if (options.json) console.log(JSON.stringify({ found: 0, enriched: 0, deferred: 0, failed: 0 }));
      else console.log(chalk.dim("Nothing to enrich."));
      return;
    }

    const model = estimateModel(config);
    const plan = planBatch(acos, model, options.maxCost);

    if (!options.json) {
      console.log();
      console.log(chalk.bold("Batch cost estimate:"));
      console.log(`  ACOs found:           ${acos.length}`);
      console.log(`  Will enrich:          ${plan.selected.length}`);
      console.log(`  Estimated total cost: ~$${plan.totalCost.toFixed(4)} (${model})`);
      if (options.maxCost !== undefined) {
        console.log(`  Budget:               $${options.maxCost.toFixed(4)}`);
        if (plan.deferred.length > 0) {
          console.log(
            chalk.yellow(
              `  Deferred:             ${plan.deferred.length} ACO(s) do not fit the budget and will not be sent to a provider.`
            )
          );
        }
      }
      console.log();
    }

    if (plan.selected.length === 0) {
      throw new CliError("Budget too small for even one ACO", EXIT.USAGE, "Raise --max-cost or omit it.");
    }

    if (!options.yes && !(await confirm("Continue?"))) {
      console.log(chalk.dim("Aborted."));
      return;
    }

    const enricher = new BatchEnricher(router, buildPipelines(pipelineNames));
    const progress = options.json ? null : ora(`Enriching 0/${plan.selected.length}...`).start();
    let spent = 0;

    const { results, errors } = await enricher.enrichMany(plan.selected, {
      force: options.force,
      tool: TOOL,
      concurrency: options.concurrency,
      onProgress: (done, total) => {
        spent += plan.perACOCost[done - 1] ?? 0;
        if (progress) progress.text = `Enriching ${done}/${total}... (~$${spent.toFixed(4)} so far)`;
      },
    });

    if (progress) progress.text = "Saving results...";
    for (const aco of results) await storage.putACO(aco);
    progress?.succeed(`Enriched ${results.length}/${plan.selected.length} ACOs`);

    if (options.json) {
      console.log(
        JSON.stringify({
          found: acos.length,
          enriched: results.length,
          deferred: plan.deferred.length,
          failed: errors.length,
          estimated_cost_usd: Number(plan.totalCost.toFixed(4)),
          model,
          errors,
        })
      );
    } else {
      if (errors.length > 0) {
        console.log();
        console.log(chalk.red(`  ${errors.length} failed:`));
        for (const err of errors) console.log(chalk.dim(`    ${err.id}: ${err.error}`));
      }
      console.log();
      console.log(chalk.green(`  Succeeded: ${results.length}`));
      if (errors.length > 0) console.log(chalk.red(`  Failed:    ${errors.length}`));
      if (plan.deferred.length > 0) console.log(chalk.yellow(`  Deferred:  ${plan.deferred.length} (over --max-cost)`));
      console.log(chalk.cyan(`  Est. cost: $${plan.totalCost.toFixed(4)}`));
    }

    if (errors.length > 0) throw new CliError(`${errors.length} ACO(s) failed to enrich`, EXIT.ERROR);
  });
