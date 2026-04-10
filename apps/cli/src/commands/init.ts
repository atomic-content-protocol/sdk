import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';

export const initCommand = new Command('init')
  .argument('[path]', 'path to create vault', '.')
  .description('Initialize a new ACP vault')
  .action(async (path: string) => {
    const vaultPath = resolve(path);
    const acpDir = join(vaultPath, '.acp');

    await mkdir(acpDir, { recursive: true });

    const config = {
      vault_path: vaultPath,
      enrichment: {
        anthropic: { model: 'claude-haiku-4-5' },
        openai: { model: 'gpt-4o-mini' },
      },
    };

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
