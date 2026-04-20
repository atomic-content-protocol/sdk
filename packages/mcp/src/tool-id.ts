import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ACP §3.13 `tool` identifier, e.g. "@atomic-content-protocol/mcp@0.1.0".
 * Read from our own package.json so this string is always in lockstep
 * with the published version. No manual upkeep.
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { name: string; version: string };

export const TOOL = `${pkg.name}@${pkg.version}`;
