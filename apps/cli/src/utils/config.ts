import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { QUALITY_TIERS, type QualityTier } from "@atomic-content-protocol/enrichment";
import { z } from "zod";
import { CliError, EXIT } from "./errors.js";

const providerSchema = z.object({ api_key: z.string().optional(), model: z.string().optional() }).strict();

export const ConfigSchema = z
  .object({
    vault_path: z.string().min(1),
    author: z.object({ id: z.string().min(1), name: z.string().min(1) }).optional(),
    enrichment: z
      .object({
        quality: z.enum(QUALITY_TIERS as unknown as [QualityTier, ...QualityTier[]]).optional(),
        anthropic: providerSchema.optional(),
        openai: providerSchema.extend({ embedding_model: z.string().optional() }).optional(),
        ollama: z
          .object({
            base_url: z.string().optional(),
            model: z.string().optional(),
            embedding_model: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ACPConfig = z.infer<typeof ConfigSchema>;

export const CONFIG_DIR = ".acp";
export const CONFIG_FILE = "config.json";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the vault root for `start`: the nearest ancestor (inclusive) that
 * contains `.acp/config.json`. Returns null when none is found.
 */
export async function findVaultRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  for (;;) {
    if (await exists(join(dir, CONFIG_DIR, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface LoadedConfig {
  config: ACPConfig;
  /** Directory that holds `.acp/config.json`, or null when running on defaults. */
  root: string | null;
}

/**
 * Load the vault config.
 *
 * - `explicitPath`: use that directory (or the vault a file lives in).
 * - otherwise: walk up from the current directory, like git does.
 * - no config anywhere: default to the current directory as the vault.
 *
 * A config file that exists but is invalid is an error — never silently
 * ignored — so a typo cannot redirect writes to a different vault.
 */
export async function loadConfig(explicitPath?: string): Promise<LoadedConfig> {
  let start = resolve(explicitPath ?? process.cwd());
  if (explicitPath && (await exists(start)) && (await stat(start)).isFile()) start = dirname(start);

  const root = await findVaultRoot(start);
  if (root === null) {
    return { config: { vault_path: start }, root: null };
  }

  const file = join(root, CONFIG_DIR, CONFIG_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch (err) {
    throw new CliError(`Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`, EXIT.USAGE);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    throw new CliError(`Invalid ${file}: ${issues}`, EXIT.USAGE);
  }

  // vault_path is stored relative to the config file so vaults can move.
  const config = parsed.data;
  config.vault_path = resolve(root, config.vault_path);
  return { config, root };
}
