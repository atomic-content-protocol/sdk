/**
 * `gray-matter` loads Node's `fs` module even when it is only parsing a
 * string. The page never reads a filesystem path.
 */

export function readFileSync(): never {
  throw new Error("fs.readFileSync is not used by the browser benchmark");
}

export function existsSync(): boolean {
  return false;
}

const fs = { readFileSync, existsSync };
export default fs;
