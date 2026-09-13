import { estimateEnrichmentCost, formatCostEstimate } from "@atomic-content-protocol/enrichment";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { loadConfig } from "../utils/config.js";
import { buildPipelines, createRouter, estimateModel, parsePipelines } from "../utils/enrichment.js";
import { CliError, EXIT } from "../utils/errors.js";
import { TOOL } from "../utils/pkg.js";
import { confirm } from "../utils/prompt.js";
import { createStorage } from "../utils/storage.js";

interface EnrichOptions {
  pipelines: string;
  force: boolean;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}

export const enrichCommand = new Command("enrich")
  .argument("<id>", "ACO id")
  .description("Enrich an ACO with AI-generated metadata")
  .option(
    "-p, --pipelines <names>",
    "Comma-separated pipelines: tag, summary, entity, classification, unified, embed",
    "unified"
  )
  .option("-f, --force", "Regenerate fields that already have values", false)
  .option("--dry-run", "Run the pipelines but do not write to the vault", false)
  .option("-y, --yes", "Skip the confirmation prompt", false)
  .option("--json", "Print the resulting frontmatter as JSON", false)
  .action(async (id: string, options: EnrichOptions, cmd: Command) => {
    const pipelineNames = parsePipelines(options.pipelines);
    const { config } = await loadConfig(cmd.optsWithGlobals()["vault"] as string | undefined);
    const storage = createStorage(config);
    const router = createRouter(config);

    const aco = await storage.getACO(id);
    if (!aco) throw new CliError(`ACO not found: ${id}`, EXIT.ERROR);

    const estimate = estimateEnrichmentCost(aco.body, "standard", { model: estimateModel(config) });
    if (!options.json) {
      console.log();
      console.log(chalk.bold("Cost estimate:"));
      console.log(formatCostEstimate(estimate));
      console.log();
    }

    if (!options.yes && !(await confirm("Continue?"))) {
      console.log(chalk.dim("Aborted."));
      return;
    }

    const spinner = options.json ? null : ora("Running pipelines...").start();
    let current = aco;
    const ran: string[] = [];
    let embedded = false;
    try {
      for (const pipeline of buildPipelines(pipelineNames)) {
        if (spinner) spinner.text = `Running ${pipeline.name} pipeline...`;
        const result = await pipeline.enrich(current, router, { force: options.force, tool: TOOL });
        if (result.model !== "skipped") ran.push(pipeline.name);
        current = result.aco;
        if (result.embedding && !options.dryRun && typeof storage.putEmbedding === "function") {
          await storage.putEmbedding(id, result.embedding, result.model);
          embedded = true;
        }
      }
    } catch (err) {
      spinner?.fail("Enrichment failed");
      throw err;
    }

    if (options.dryRun) {
      spinner?.succeed(`Dry run complete (no changes written). Ran: ${ran.join(", ") || "nothing"}`);
    } else if (ran.length === 0) {
      spinner?.succeed("Nothing to do — all requested fields already have values (use --force to regenerate)");
    } else {
      await storage.putACO(current);
      spinner?.succeed(`ACO enriched and saved (${ran.join(", ")}${embedded ? ", embedding stored" : ""})`);
    }

    const fm = current.frontmatter;
    if (options.json) {
      console.log(JSON.stringify(fm, null, 2));
      return;
    }
    if (Array.isArray(fm["tags"])) console.log(chalk.cyan("  Tags:"), (fm["tags"] as string[]).join(", "));
    if (fm["summary"]) console.log(chalk.cyan("  Summary:"), fm["summary"]);
    if (fm["classification"]) console.log(chalk.cyan("  Classification:"), fm["classification"]);
    if (fm["language"]) console.log(chalk.cyan("  Language:"), fm["language"]);
    if (Array.isArray(fm["key_entities"])) {
      const entities = fm["key_entities"] as Array<{ name: string; type: string }>;
      console.log(chalk.cyan("  Entities:"), entities.map((e) => `${e.name} (${e.type})`).join(", "));
    }
  });
