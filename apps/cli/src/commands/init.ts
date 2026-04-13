import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';

function promptLine(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((res) => rl.question(question, (answer) => res(answer.trim())));
}

export const initCommand = new Command('init')
  .argument('[path]', 'path to create vault', '.')
  .description('Initialize a new ACP vault')
  .action(async (path: string) => {
    const vaultPath = resolve(path);
    const acpDir = join(vaultPath, '.acp');

    await mkdir(acpDir, { recursive: true });

    // Prompt for author details
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const authorName = await promptLine(rl, 'Author name (leave blank to skip): ');
    const authorId = await promptLine(rl, 'Author email/id (leave blank to skip): ');
    rl.close();

    const config: Record<string, unknown> = {
      vault_path: vaultPath,
      enrichment: {
        anthropic: { model: 'claude-haiku-4-5' },
        openai: { model: 'gpt-4o-mini' },
      },
    };

    if (authorName || authorId) {
      config.author = {
        id: authorId || authorName,
        name: authorName || authorId,
      };
    }

    await writeFile(join(acpDir, 'config.json'), JSON.stringify(config, null, 2));
    await writeFile(join(acpDir, '.gitignore'), 'config.json\nindex.json\n');

    console.log(chalk.green('Vault initialized at'), chalk.bold(vaultPath));
    console.log();
    console.log('Next steps:');
    console.log(`  ${chalk.cyan('acp create')}          Create your first ACO`);
    console.log(`  ${chalk.cyan('acp validate')}        Validate ACOs in this vault`);
    console.log(`  ${chalk.cyan('acp serve')}           Start MCP server for Claude`);
    console.log();
    console.log(chalk.dim('Set ANTHROPIC_API_KEY or OPENAI_API_KEY env vars to enable enrichment.'));
  });
