import { Command } from 'commander';
import { FilesystemAdapter } from '@acp/core';
import {
  UnifiedPipeline,
  TagPipeline,
  SummaryPipeline,
  EntityPipeline,
  ClassificationPipeline,
  BatchEnricher,
} from '@acp/enrichment';
import type { IEnrichmentPipeline } from '@acp/enrichment';
import { loadConfig } from '../utils/config.js';
import { createRouter } from '../utils/enrichment.js';
import chalk from 'chalk';
import ora from 'ora';

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

    let completed = 0;
    const progressSpinner = ora(`Enriching 0/${acos.length}...`).start();

    const { results, errors } = await enricher.enrichMany(acos, {
      force: options.force as boolean,
      onProgress: (done, total) => {
        completed = done;
        progressSpinner.text = `Enriching ${done}/${total}...`;
      },
    });

    // Persist all enriched ACOs
    progressSpinner.text = 'Saving results...';
    for (const enriched of results) {
      await storage.putACO(enriched);
    }

    progressSpinner.succeed(`Enriched ${results.length}/${acos.length} ACOs`);

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
    if (errors.length > 0) {
      console.log(chalk.red(`  Failed:    ${errors.length}`));
    }
  });
