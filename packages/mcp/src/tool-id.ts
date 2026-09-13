import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Package identity, read from our own package.json so these strings are
 * always in lockstep with the published version. No manual upkeep.
 */
export const PKG = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
  name: string;
  version: string;
};

/** ACP §3.13 `tool` identifier, e.g. "@atomic-content-protocol/mcp@0.1.1". */
export const TOOL = `${PKG.name}@${PKG.version}`;
