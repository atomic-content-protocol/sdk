import { Command } from "commander";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { MODEL_PRESETS, DEFAULT_QUALITY } from "@atomic-content-protocol/enrichment";
import { ask } from "../utils/prompt.js";
import { CONFIG_DIR, CONFIG_FILE, type ACPConfig } from "../utils/config.js";
import { CliError, EXIT } from "../utils/errors.js";

export const initCommand = new Command("init")
  .argument("[path]", "directory to create the vault in", ".")
  .description("Initialize a new ACP vault (.acp/config.json)")
  .option("--author-id <id>", "Author email/id (skips the prompt)")
  .option("--author-name <name>", "Author display name (skips the prompt)")
  .option("-y, --yes", "Do not prompt; write defaults", false)
  .option("--force", "Overwrite an existing config", false)
  .action(async (path: string, options: { authorId?: string; authorName?: string; yes: boolean; force: boolean }) => {
    const vaultPath = resolve(path);
    const acpDir = join(vaultPath, CONFIG_DIR);
    const configPath = join(acpDir, CONFIG_FILE);

    const already = await stat(configPath).then(() => true, () => false);
    if (already && !options.force) {
      throw new CliError(`Vault already initialised at ${vaultPath}`, EXIT.USAGE, "Pass --force to overwrite .acp/config.json.");
    }

    await mkdir(acpDir, { recursive: true });

    let authorName = options.authorName ?? "";
    let authorId = options.authorId ?? "";
    if (!options.yes && !authorName && !authorId) {
      authorName = await ask("Author name (leave blank to skip): ");
      authorId = await ask("Author email/id (leave blank to skip): ");
    }

    const preset = MODEL_PRESETS[DEFAULT_QUALITY];
    const config: ACPConfig = {
      // Relative to the config file so the vault can be moved or checked in.
      vault_path: ".",
      enrichment: {
        quality: DEFAULT_QUALITY,
        anthropic: { model: preset.anthropic },
        openai: { model: preset.openai },
      },
    };
    if (authorName || authorId) {
      config.author = { id: authorId || authorName, name: authorName || authorId };
    }

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    await writeFile(join(acpDir, ".gitignore"), "index.json\nembeddings.json\n");

    console.log(chalk.green("Vault initialized at"), chalk.bold(vaultPath));
    console.log();
    console.log("Next steps:");
    console.log(`  ${chalk.cyan("acp create --title ...")}   Create your first ACO`);
    console.log(`  ${chalk.cyan("acp validate")}             Validate ACOs in this vault`);
    console.log(`  ${chalk.cyan("acp serve")}                Start the MCP server for Claude`);
    console.log();
    console.log(chalk.dim("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable enrichment. API keys belong in the environment, not in config.json."));
  });
