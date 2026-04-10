import { Command } from 'commander';
import { FilesystemAdapter, validateACO } from '@acp/core';
import { loadConfig } from '../utils/config.js';
import chalk from 'chalk';
import ora from 'ora';

export const validateCommand = new Command('validate')
  .argument('[path]', 'vault path or single ACO file')
  .description('Validate ACOs against the ACP schema')
  .action(async (path?: string) => {
    const config = await loadConfig(path);
    const storage = new FilesystemAdapter(config.vault_path);

    const spinner = ora('Scanning vault...').start();
    const acos = await storage.listACOs();
    spinner.succeed(`Found ${acos.length} ACOs`);

    let valid = 0;
    let invalid = 0;
    const errors: Array<{ id: string; errors: Array<{ path: string; message: string }> }> = [];

    for (const aco of acos) {
      const result = validateACO(aco.frontmatter);
      if (result.valid) {
        valid++;
      } else {
        invalid++;
        const id = (aco.frontmatter as Record<string, unknown>)['id'] as string || 'unknown';
        errors.push({ id, errors: result.errors ?? [] });
      }
    }

    console.log();
    console.log(chalk.green(`  Valid:   ${valid}`));
    if (invalid > 0) {
      console.log(chalk.red(`  Invalid: ${invalid}`));
      console.log();
      for (const err of errors) {
        console.log(chalk.red(`  ${err.id}:`));
        for (const e of err.errors) {
          console.log(chalk.dim(`    ${e.path}: ${e.message}`));
        }
      }
      process.exit(1);
    } else {
      console.log(chalk.green('\n  All ACOs are valid.'));
    }
  });
