import { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { parseACO, validateACO } from "@atomic-content-protocol/core";
import type { ACO } from "@atomic-content-protocol/core";
import { loadConfig } from "../utils/config.js";
import { createStorage } from "../utils/storage.js";
import { CliError, EXIT } from "../utils/errors.js";

interface Report {
  total: number;
  valid: number;
  invalid: Array<{ id: string; errors: Array<{ path: string; message: string }> }>;
}

async function validateFile(file: string): Promise<Report> {
  const raw = await readFile(file, "utf-8");
  const { frontmatter } = parseACO(raw);
  const result = validateACO(frontmatter);
  if (result.valid) return { total: 1, valid: 1, invalid: [] };
  const id = String(frontmatter["id"] ?? file);
  return { total: 1, valid: 0, invalid: [{ id, errors: result.errors ?? [] }] };
}

function validateACOs(acos: ACO[]): Report {
  const report: Report = { total: acos.length, valid: 0, invalid: [] };
  for (const aco of acos) {
    const result = validateACO(aco.frontmatter);
    if (result.valid) report.valid++;
    else report.invalid.push({ id: String(aco.frontmatter["id"] ?? "unknown"), errors: result.errors ?? [] });
  }
  return report;
}

export const validateCommand = new Command("validate")
  .argument("[path]", "vault directory or a single ACO .md file (default: current vault)")
  .description("Validate ACOs against the ACP schema. Exit code 3 if any are invalid.")
  .option("--json", "Print the report as JSON", false)
  .action(async (path: string | undefined, options: { json: boolean }, cmd: Command) => {
    const target = path ? resolve(path) : undefined;
    let report: Report;

    if (target && (await stat(target).catch(() => null))?.isFile()) {
      report = await validateFile(target);
    } else {
      const { config } = await loadConfig(target ?? (cmd.optsWithGlobals()["vault"] as string | undefined));
      const storage = createStorage(config);
      const spinner = options.json ? null : ora("Scanning vault...").start();
      // Validate what is on disk, not what the index remembers: files added
      // or edited by hand must be checked too, so rebuild the index first.
      await storage.rebuildIndex();
      const acos = await storage.listACOs();
      spinner?.succeed(`Found ${acos.length} ACOs`);
      report = validateACOs(acos);
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log();
      console.log(chalk.green(`  Valid:   ${report.valid}`));
      if (report.invalid.length > 0) {
        console.log(chalk.red(`  Invalid: ${report.invalid.length}`));
        console.log();
        for (const item of report.invalid) {
          console.log(chalk.red(`  ${item.id}:`));
          for (const e of item.errors) console.log(chalk.dim(`    ${e.path}: ${e.message}`));
        }
      } else {
        console.log(chalk.green("\n  All ACOs are valid."));
      }
    }

    if (report.invalid.length > 0) {
      throw new CliError(`${report.invalid.length} invalid ACO(s)`, EXIT.INVALID);
    }
  });
