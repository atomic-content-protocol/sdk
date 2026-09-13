#!/usr/bin/env node

import chalk from "chalk";
import { Command, CommanderError } from "commander";
import { createCommand } from "./commands/create.js";
import { enrichCommand } from "./commands/enrich.js";
import { enrichBatchCommand } from "./commands/enrich-batch.js";
import { initCommand } from "./commands/init.js";
import { searchCommand } from "./commands/search.js";
import { serveCommand } from "./commands/serve.js";
import { statsCommand } from "./commands/stats.js";
import { validateCommand } from "./commands/validate.js";
import { CliError, EXIT } from "./utils/errors.js";
import { PKG } from "./utils/pkg.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("acp")
    .description("Atomic Content Protocol CLI — create, validate, enrich, and serve ACOs")
    .version(PKG.version)
    .option("--vault <path>", "Vault directory (default: nearest .acp/config.json, else current directory)")
    .exitOverride()
    .configureOutput({ writeErr: (s) => process.stderr.write(s) });

  program.addCommand(initCommand);
  program.addCommand(createCommand);
  program.addCommand(validateCommand);
  program.addCommand(enrichCommand);
  program.addCommand(enrichBatchCommand);
  program.addCommand(searchCommand);
  program.addCommand(serveCommand);
  program.addCommand(statsCommand);

  return program;
}

/** Map any failure to a clean, single-line message and exit code. */
export function reportError(err: unknown): number {
  if (err instanceof CommanderError) {
    // --help / --version exit 0; usage errors already printed by commander.
    return err.exitCode;
  }
  if (err instanceof CliError) {
    process.stderr.write(chalk.red(`error: ${err.message}`) + "\n");
    if (err.hint) process.stderr.write(chalk.dim(`  ${err.hint}`) + "\n");
    return err.exitCode;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.red(`error: ${message}`) + "\n");
  if (process.env["ACP_DEBUG"] && err instanceof Error && err.stack) {
    process.stderr.write(chalk.dim(err.stack) + "\n");
  } else {
    process.stderr.write(chalk.dim("  Set ACP_DEBUG=1 for a stack trace.") + "\n");
  }
  return EXIT.ERROR;
}

async function main(): Promise<void> {
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (err) {
    process.exitCode = reportError(err);
  }
}

void main();
