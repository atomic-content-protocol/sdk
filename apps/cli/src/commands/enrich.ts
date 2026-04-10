import { Command } from 'commander';
import { FilesystemAdapter } from '@acp/core';
import {
  UnifiedPipeline,
  TagPipeline,
  SummaryPipeline,
  EntityPipeline,
  ClassificationPipeline,
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

export const enrichCommand = new Command('enrich')
  .argument('<target>', 'ACO id or file path')
  .description('Enrich an ACO with AI-generated metadata')
  .option('-p, --pipelines <names>', 'Comma-separated pipeline names', 'unified')
  .option('-f, --force', 'Overwrite existing enrichment', false)
  .option('--dry-run', 'Preview without writing', false)
  .action(async (target: string, options) => {
    const config = await loadConfig();
    const storage = new FilesystemAdapter(config.vault_path);
    const router = createRouter(config);

    if (!router) {
      console.error(chalk.red('No enrichment providers configured.'));
      console.error(chalk.dim('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.'));
      process.exit(1);
    }

    const spinner = ora('Reading ACO...').start();

    const aco = await storage.getACO(target);
    if (!aco) {
      spinner.fail(`ACO not found: ${target}`);
      process.exit(1);
    }

    const pipelineNames = (options.pipelines as string).split(',').map((s: string) => s.trim());

    let current = aco;
    for (const name of pipelineNames) {
      const PipelineClass = PIPELINE_MAP[name];
      if (!PipelineClass) {
        spinner.fail(`Unknown pipeline: ${name}. Valid options: ${Object.keys(PIPELINE_MAP).join(', ')}`);
        process.exit(1);
      }

      spinner.text = `Running ${name} pipeline...`;
      const pipeline = new PipelineClass();
      const result = await pipeline.enrich(current, router, { force: options.force as boolean });
      current = result.aco;
    }

    if (!(options.dryRun as boolean)) {
      await storage.putACO(current);
      spinner.succeed('ACO enriched and saved');
    } else {
      spinner.succeed('Dry run complete (no changes written)');
    }

    // Show what was updated
    const fm = current.frontmatter as Record<string, unknown>;
    if (fm['tags']) console.log(chalk.cyan('  Tags:'), (fm['tags'] as string[]).join(', '));
    if (fm['summary']) console.log(chalk.cyan('  Summary:'), fm['summary']);
    if (fm['classification']) console.log(chalk.cyan('  Classification:'), fm['classification']);
    if (fm['key_entities']) {
      const entities = fm['key_entities'] as Array<{ name: string; type: string }>;
      console.log(chalk.cyan('  Entities:'), entities.map(e => `${e.name} (${e.type})`).join(', '));
    }
  });
