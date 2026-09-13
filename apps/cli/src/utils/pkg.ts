import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Package identity read from package.json so the CLI never drifts from its published version. */
export const PKG = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
  name: string;
  version: string;
};

/** ACP §3.13 `tool` identifier stamped into provenance records. */
export const TOOL = `${PKG.name}@${PKG.version}`;
