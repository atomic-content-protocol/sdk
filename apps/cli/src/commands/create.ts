import { Command } from "commander";
import chalk from "chalk";
import { createACO, SOURCE_TYPES, type SourceType } from "@atomic-content-protocol/core";
import { loadConfig } from "../utils/config.js";
import { createStorage } from "../utils/storage.js";
import { resolveAuthor } from "../utils/author.js";
import { CliError, EXIT } from "../utils/errors.js";

interface CreateOptions {
  title?: string;
  sourceType: string;
  body: string;
  url?: string;
  authorId?: string;
  authorName?: string;
  tags?: string;
  json: boolean;
}

export const createCommand = new Command("create")
  .description("Create a new ACO")
  .option("-t, --title <title>", "ACO title")
  .option("-s, --source-type <type>", `Source type (${SOURCE_TYPES.join(" | ")})`, "manual")
  .option("-b, --body <body>", "Content body", "")
  .option("-u, --url <url>", "Fetch the body from an HTTPS URL (sets source_type=link)")
  .option("--author-id <id>", "Author ID")
  .option("--author-name <name>", "Author name")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Print the created frontmatter as JSON", false)
  .action(async (options: CreateOptions, cmd: Command) => {
    if (!(SOURCE_TYPES as readonly string[]).includes(options.sourceType)) {
      throw new CliError(`Invalid --source-type "${options.sourceType}"`, EXIT.USAGE, `Valid values: ${SOURCE_TYPES.join(", ")}`);
    }
    if (options.url && options.body) {
      throw new CliError("Provide --url or --body, not both", EXIT.USAGE);
    }

    const { config } = await loadConfig(cmd.optsWithGlobals()["vault"] as string | undefined);
    const storage = createStorage(config);

    const author = await resolveAuthor({
      authorId: options.authorId,
      authorName: options.authorName,
      config,
      cwd: config.vault_path,
    });

    const tags = options.tags?.split(",").map((t) => t.trim()).filter(Boolean);

    const aco = await createACO({
      title: options.title,
      ...(options.url ? { url: options.url } : { body: options.body }),
      source_type: options.url && options.sourceType === "manual" ? "link" : (options.sourceType as SourceType),
      author,
      frontmatter: tags && tags.length > 0 ? { tags } : undefined,
    });

    await storage.putACO(aco);

    const id = String(aco.frontmatter["id"]);
    if (options.json) {
      console.log(JSON.stringify(aco.frontmatter, null, 2));
      return;
    }
    console.log(chalk.green("ACO created:"), chalk.bold(id));
    console.log(chalk.dim(`File: ${config.vault_path}/${id}.md`));
    const fetchStatus = aco.frontmatter["fetch_status"] as { ok?: boolean; message?: string } | undefined;
    if (fetchStatus && fetchStatus.ok === false) {
      console.log(chalk.yellow(`Warning: URL fetch failed (${fetchStatus.message}); body synthesised from title/url.`));
    }
  });
