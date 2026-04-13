import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';

export interface AuthorInfo {
  id: string;
  name: string;
}

/**
 * resolveAuthor — determine the author identity for an ACO.
 *
 * Resolution order (first match wins):
 *   1. CLI flags (`options.authorId` + `options.authorName`)
 *   2. `.acp/config.json` author field (`options.config.author`)
 *   3. Git config (`git config user.name` / `git config user.email`)
 *   4. Interactive readline prompt (if `options.interactive !== false`)
 *   5. Unknown fallback
 */
export async function resolveAuthor(options?: {
  authorId?: string;
  authorName?: string;
  config?: { author?: AuthorInfo };
  interactive?: boolean;
}): Promise<AuthorInfo> {
  // 1. CLI flags — both must be present
  if (options?.authorId && options?.authorName) {
    return { id: options.authorId, name: options.authorName };
  }

  // 2. Config file author field — both id and name must be present
  if (options?.config?.author?.id && options?.config?.author?.name) {
    return options.config.author;
  }

  // 3. Git config
  try {
    const name = execSync('git config user.name', { encoding: 'utf-8' }).trim();
    const email = execSync('git config user.email', { encoding: 'utf-8' }).trim();
    if (name && email) {
      return { id: email, name };
    }
    if (name || email) {
      return { id: email || name, name: name || email };
    }
  } catch {
    // git not available or no config set — continue to next step
  }

  // 4. Interactive prompt
  const interactive = options?.interactive !== false;
  if (interactive) {
    const author = await promptForAuthor();
    if (author) return author;
  }

  // 5. Unknown fallback
  return { id: 'unknown', name: 'Unknown' };
}

function promptForAuthor(): Promise<AuthorInfo | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    rl.question('Author name: ', (name) => {
      rl.question('Author email/id: ', (id) => {
        rl.close();
        const trimmedName = name.trim();
        const trimmedId = id.trim();
        if (trimmedName || trimmedId) {
          resolve({
            id: trimmedId || trimmedName,
            name: trimmedName || trimmedId,
          });
        } else {
          resolve(null);
        }
      });
    });
  });
}
