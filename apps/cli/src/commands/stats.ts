import { Command } from 'commander';
import { FilesystemAdapter } from '@atomic-content-protocol/core';
import { loadConfig } from '../utils/config.js';
import chalk from 'chalk';
import ora from 'ora';

export const statsCommand = new Command('stats')
  .description('Show vault statistics')
  .action(async () => {
    const config = await loadConfig();
    const storage = new FilesystemAdapter(config.vault_path);

    const spinner = ora('Loading vault stats...').start();

    const [acos, containers, collections] = await Promise.all([
      storage.listACOs(),
      storage.listContainers(),
      storage.listCollections(),
    ]);

    spinner.succeed('Vault loaded');
    console.log();

    // ---- Totals ----
    console.log(chalk.bold('Vault Summary'));
    console.log(`  ${chalk.cyan('ACOs:')}        ${acos.length}`);
    console.log(`  ${chalk.cyan('Containers:')}  ${containers.length}`);
    console.log(`  ${chalk.cyan('Collections:')} ${collections.length}`);
    console.log();

    if (acos.length === 0) {
      console.log(chalk.dim('  No ACOs found. Run `acp create` to get started.'));
      return;
    }

    // ---- Breakdown by source_type ----
    const bySourceType: Record<string, number> = {};
    for (const aco of acos) {
      const st = (aco.frontmatter['source_type'] as string | undefined) || 'unknown';
      bySourceType[st] = (bySourceType[st] ?? 0) + 1;
    }

    console.log(chalk.bold('By Source Type'));
    for (const [type, count] of Object.entries(bySourceType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${chalk.cyan(type.padEnd(20))} ${count}`);
    }
    console.log();

    // ---- Breakdown by status ----
    const byStatus: Record<string, number> = {};
    for (const aco of acos) {
      const status = (aco.frontmatter['status'] as string | undefined) || 'none';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }

    console.log(chalk.bold('By Status'));
    for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${chalk.cyan(status.padEnd(20))} ${count}`);
    }
    console.log();

    // ---- Enrichment coverage ----
    let withTags = 0;
    let withSummary = 0;
    let withEntities = 0;
    let withClassification = 0;

    for (const aco of acos) {
      const fm = aco.frontmatter as Record<string, unknown>;
      if (Array.isArray(fm['tags']) && (fm['tags'] as unknown[]).length > 0) withTags++;
      if (fm['summary']) withSummary++;
      if (Array.isArray(fm['key_entities']) && (fm['key_entities'] as unknown[]).length > 0) withEntities++;
      if (fm['classification']) withClassification++;
    }

    const pct = (n: number): string => `${Math.round((n / acos.length) * 100)}%`;

    console.log(chalk.bold('Enrichment Coverage'));
    console.log(`  ${chalk.cyan('Tags:'.padEnd(20))} ${withTags}/${acos.length} (${pct(withTags)})`);
    console.log(`  ${chalk.cyan('Summary:'.padEnd(20))} ${withSummary}/${acos.length} (${pct(withSummary)})`);
    console.log(`  ${chalk.cyan('Entities:'.padEnd(20))} ${withEntities}/${acos.length} (${pct(withEntities)})`);
    console.log(`  ${chalk.cyan('Classification:'.padEnd(20))} ${withClassification}/${acos.length} (${pct(withClassification)})`);
    console.log();

    // ---- Token counts ----
    let totalApproximate = 0;
    let tokenCount = 0;

    for (const aco of acos) {
      const tc = aco.frontmatter['token_counts'] as Record<string, number> | undefined;
      if (tc?.['approximate']) {
        totalApproximate += tc['approximate'];
        tokenCount++;
      }
    }

    console.log(chalk.bold('Token Counts'));
    console.log(`  ${chalk.cyan('ACOs with counts:'.padEnd(20))} ${tokenCount}/${acos.length}`);
    console.log(`  ${chalk.cyan('Total approximate:'.padEnd(20))} ${totalApproximate.toLocaleString()}`);
    if (tokenCount > 0) {
      const avg = Math.round(totalApproximate / tokenCount);
      console.log(`  ${chalk.cyan('Average per ACO:'.padEnd(20))} ${avg.toLocaleString()}`);
    }
    console.log();
  });
