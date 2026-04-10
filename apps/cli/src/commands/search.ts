import { Command } from 'commander';
import { FilesystemAdapter } from '@acp/core';
import { loadConfig } from '../utils/config.js';
import chalk from 'chalk';
import ora from 'ora';

export const searchCommand = new Command('search')
  .argument('<query>', 'Search query')
  .description('Search ACOs in the vault by title, tags, summary, or body')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('--status <status>', 'Filter by status')
  .option('-l, --limit <n>', 'Max results to show', '20')
  .action(async (query: string, options) => {
    const config = await loadConfig();
    const storage = new FilesystemAdapter(config.vault_path);

    const spinner = ora('Searching...').start();

    const searchQuery: {
      search?: string;
      tags?: string[];
      status?: string[];
    } = {
      search: query,
    };

    if (options.tags) {
      searchQuery.tags = (options.tags as string).split(',').map((t: string) => t.trim());
    }
    if (options.status) {
      searchQuery.status = [(options.status as string).trim()];
    }

    const limit = parseInt(options.limit as string, 10) || 20;
    const results = await storage.queryACOs(searchQuery);
    const limited = results.slice(0, limit);

    spinner.succeed(`Found ${results.length} result${results.length !== 1 ? 's' : ''}`);

    if (limited.length === 0) {
      console.log(chalk.dim('\n  No ACOs matched your search.'));
      return;
    }

    console.log();
    for (const aco of limited) {
      const fm = aco.frontmatter as Record<string, unknown>;
      const id = fm['id'] as string;
      const title = (fm['title'] as string | undefined) || chalk.italic('(untitled)');
      const tags = Array.isArray(fm['tags']) ? (fm['tags'] as string[]) : [];
      const status = (fm['status'] as string | undefined) || '';
      const created = (fm['created'] as string | undefined) || '';
      const summary = (fm['summary'] as string | undefined) || '';

      console.log(`${chalk.bold(title)}`);
      console.log(`  ${chalk.dim('id:')} ${id}`);
      if (created) console.log(`  ${chalk.dim('created:')} ${created.split('T')[0]}`);
      if (status) console.log(`  ${chalk.dim('status:')} ${status}`);
      if (tags.length > 0) console.log(`  ${chalk.dim('tags:')} ${tags.join(', ')}`);
      if (summary) {
        const truncated = summary.length > 120 ? summary.slice(0, 117) + '...' : summary;
        console.log(`  ${chalk.dim('summary:')} ${truncated}`);
      }
      console.log();
    }

    if (results.length > limit) {
      console.log(chalk.dim(`  Showing ${limit} of ${results.length} results. Use --limit to see more.`));
    }
  });
