import { execFileSync } from "node:child_process";
import { ask, isInteractive } from "./prompt.js";

export interface AuthorInfo {
  id: string;
  name: string;
}

function gitConfig(key: string, cwd?: string): string {
  try {
    return execFileSync("git", ["config", key], { encoding: "utf-8", cwd, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/**
 * resolveAuthor — determine the author identity for an ACO.
 *
 * Resolution order (first match wins):
 *   1. CLI flags (`options.authorId` + `options.authorName`)
 *   2. `.acp/config.json` author field (`options.config.author`)
 *   3. Git config (`user.name` / `user.email`), read from the vault directory
 *   4. Interactive prompt — only when stdin/stderr are TTYs
 *   5. Unknown fallback
 */
export async function resolveAuthor(options?: {
  authorId?: string;
  authorName?: string;
  config?: { author?: AuthorInfo };
  interactive?: boolean;
  cwd?: string;
}): Promise<AuthorInfo> {
  if (options?.authorId && options?.authorName) {
    return { id: options.authorId, name: options.authorName };
  }

  if (options?.config?.author?.id && options?.config?.author?.name) {
    return options.config.author;
  }

  const name = gitConfig("user.name", options?.cwd);
  const email = gitConfig("user.email", options?.cwd);
  if (name || email) {
    return { id: email || name, name: name || email };
  }

  if (options?.interactive !== false && isInteractive()) {
    const promptedName = await ask("Author name: ");
    const promptedId = await ask("Author email/id: ");
    if (promptedName || promptedId) {
      return { id: promptedId || promptedName, name: promptedName || promptedId };
    }
  }

  return { id: "unknown", name: "Unknown" };
}
