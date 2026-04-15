import { Command } from 'commander';
import { FilesystemAdapter } from '@acp/core';
import {
  UnifiedPipeline,
  TagPipeline,
  SummaryPipeline,
  EntityPipeline,
  ClassificationPipeline,
  BatchEnricher,
  estimateEnrichmentCost,
  formatCostEstimate,
} from '@acp/enrichment';
import type { IEnrichmentPipeline } from '@acp/enrichment';
import { loadConfig } from '../utils/config.js';
import { createRouter } from '../utils/enrichment.js';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'node:readline';

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message + ' [Y/n] ', answer => {
      rl.close();
      resolve(!answer || answer.toLowerCase() === 'y');
    });
  });
}

const PIPELINE_MAP: Record<string, new () => IEnrichmentPipeline> = {
  tag: TagPipeline,
  summary: SummaryPipeline,
  entity: EntityPipeline,
  classification: ClassificationPipeline,
  unified: UnifiedPipeline,
};

export const enrichBatchCommand = new Command('enrich-batch')
  .description('Batch enrich all ACOs in a vault')
  .option('-p, --pipelines <names>', 'Comma-separated pipeline names', 'unified')
  .option('-f, --force', 'Overwrite existing enrichment', false)
  .option('--filter-tags <tags>', 'Only enrich ACOs with these tags (comma-separated)')
  .option('--filter-status <status>', 'Only enrich ACOs with this status')
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .option('--max-cost <amount>', 'Stop batch if cumulative cost exceeds this amount (USD)', parseFloat)
  .action(async (options) => {
    const config = await loadConfig();
    const storage = new FilesystemAdapter(config.vault_path);
    const router = createRouter(config);

    if (!router) {
      console.error(chalk.red('No enrichment providers configured.'));
      console.error(chalk.dim('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.'));
      process.exit(1);
    }

    const spinner = ora('Scanning vault...').start();

    // Build query from filter options
    const query: { tags?: string[]; status?: string[] } = {};
    if (options.filterTags) {
      query.tags = (options.filterTags as string).split(',').map((t: string) => t.trim());
    }
    if (options.filterStatus) {
      query.status = [(options.filterStatus as string).trim()];
    }

    const acos =
      Object.keys(query).length > 0
        ? await storage.queryACOs(query)
        : await storage.listACOs();

    spinner.succeed(`Found ${acos.length} ACOs to enrich`);

    if (acos.length === 0) {
      console.log(chalk.dim('Nothing to enrich.'));
      return;
    }

    // Aggregate cost estimate across all ACOs
    const aggregateEstimate = acos.reduce(
      (acc, aco) => {
        const est = estimateEnrichmentCost(aco.body);
        return {
          totalCost: acc.totalCost + est.estimatedCost['claude-haiku-4-5'],
          totalSavingsPerRead: acc.totalSavingsPerRead + est.savingsPerRead,
          totalContentTokens: acc.totalContentTokens + est.contentTokens,
        };
      },
      { totalCost: 0, totalSavingsPerRead: 0, totalContentTokens: 0 }
    );

    console.log();
    console.log(chalk.bold('Batch cost estimate:'));
    console.log(`  ACOs to enrich:       ${acos.length}`);
    console.log(`  Total content:        ${aggregateEstimate.totalContentTokens.toLocaleString()} tokens`);
    console.log(`  Estimated total cost: ~$${aggregateEstimate.totalCost.toFixed(4)} (Claude Haiku)`);
    console.log(`  Total savings/read:   ${aggregateEstimate.totalSavingsPerRead.toLocaleString()} tokens`);
    if (options.maxCost !== undefined) {
      const maxCost = options.maxCost as number;
      console.log(`  Max cost limit:       $${maxCost.toFixed(4)}`);
      if (aggregateEstimate.totalCost > maxCost) {
        console.log(chalk.yellow(`  Warning: estimated cost exceeds --max-cost limit; batch will stop early.`));
      }
    }
    console.log();

    if (!(options.yes as boolean)) {
      const ok = await confirm('Continue?');
      if (!ok) {
        console.log(chalk.dim('Aborted.'));
        process.exit(0);
      }
    }

    // Build pipeline instances
    const pipelineNames = (options.pipelines as string).split(',').map((s: string) => s.trim());
    const pipelines: IEnrichmentPipeline[] = [];
    for (const name of pipelineNames) {
      const PipelineClass = PIPELINE_MAP[name];
      if (!PipelineClass) {
        console.error(chalk.red(`Unknown pipeline: ${name}. Valid options: ${Object.keys(PIPELINE_MAP).join(', ')}`));
        process.exit(1);
      }
      pipelines.push(new PipelineClass());
    }

    const enricher = new BatchEnricher(router, pipelines);
    const maxCost = options.maxCost as number | undefined;

    // Pre-compute per-ACO cost estimates so we can accumulate as progress fires
    const perACOCosts = acos.map(aco =>
      estimateEnrichmentCost(aco.body).estimatedCost['claude-haiku-4-5']
    );

    let completed = 0;
    let cumulativeCost = 0;
    let stoppedEarly = false;
    const progressSpinner = ora(`Enriching 0/${acos.length}...`).start();

    const { results, errors } = await enricher.enrichMany(acos, {
      force: options.force as boolean,
      onProgress: (done, total) => {
        // Add the cost of the ACO that just completed (done is 1-indexed)
        cumulativeCost += perACOCosts[done - 1] ?? 0;
        completed = done;
        progressSpinner.text = `Enriching ${done}/${total}... ($${cumulativeCost.toFixed(4)} so far)`;
      },
    });

    // Check max-cost during save phase — stop persisting if over budget
    progressSpinner.text = 'Saving results...';
    let saved = 0;
    let saveCumulativeCost = 0;
    for (let i = 0; i < results.length; i++) {
      saveCumulativeCost += perACOCosts[i] ?? 0;
      if (maxCost !== undefined && saveCumulativeCost > maxCost) {
        stoppedEarly = true;
        break;
      }
      await storage.putACO(results[i]!);
      saved++;
    }

    if (stoppedEarly) {
      progressSpinner.warn(
        `Stopped early: cost limit $${maxCost!.toFixed(4)} reached. Saved ${saved}/${acos.length} ACOs.`
      );
    } else {
      progressSpinner.succeed(`Enriched ${results.length}/${acos.length} ACOs`);
    }

    if (errors.length > 0) {
      console.log();
      console.log(chalk.red(`  ${errors.length} failed:`));
      for (const err of errors) {
        console.log(chalk.dim(`    ${err.id}: ${err.error}`));
      }
    }

    console.log();
    console.log(chalk.green(`  Completed: ${completed}`));
    console.log(chalk.green(`  Succeeded: ${results.length}`));
    console.log(chalk.cyan(`  Saved:     ${saved}`));
    console.log(chalk.cyan(`  Est. cost: $${cumulativeCost.toFixed(4)}`));
    if (errors.length > 0) {
      console.log(chalk.red(`  Failed:    ${errors.length}`));
    }
    if (stoppedEarly) {
      console.log(chalk.yellow(`  Remaining: ${acos.length - saved} (cost limit reached)`));
    }
  });
