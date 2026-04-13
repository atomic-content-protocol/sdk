import { Command } from 'commander';
import { createACO, FilesystemAdapter } from '@acp/core';
import { loadConfig } from '../utils/config.js';
import { resolveAuthor } from '../utils/author.js';
import chalk from 'chalk';

export const createCommand = new Command('create')
  .description('Create a new ACO')
  .option('-t, --title <title>', 'ACO title')
  .option('-s, --source-type <type>', 'Source type', 'manual')
  .option('-b, --body <body>', 'Content body', '')
  .option('--author-id <id>', 'Author ID')
  .option('--author-name <name>', 'Author name')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (options) => {
    const config = await loadConfig();
    const storage = new FilesystemAdapter(config.vault_path);

    const author = await resolveAuthor({
      authorId: options.authorId as string | undefined,
      authorName: options.authorName as string | undefined,
      config,
    });

    const aco = await createACO({
      title: options.title as string | undefined,
      body: options.body as string,
      source_type: options.sourceType as
        | 'link'
        | 'uploaded_md'
        | 'manual'
        | 'converted_pdf'
        | 'converted_doc'
        | 'converted_video'
        | 'selected_text'
        | 'llm_capture'
        | undefined,
      author,
      frontmatter: options.tags
        ? { tags: (options.tags as string).split(',').map((t: string) => t.trim()) }
        : undefined,
    });

    await storage.putACO(aco);

    const id = (aco.frontmatter as Record<string, unknown>)['id'] as string;
    console.log(chalk.green('ACO created:'), chalk.bold(id));
    console.log(chalk.dim(`File: ${config.vault_path}/${id}.md`));
  });
