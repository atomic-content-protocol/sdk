import { createInterface } from "node:readline";

/** True when we can ask the user something. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/** Ask a single question on stderr (stdout may be piped). Returns "" when non-interactive. */
export async function ask(question: string): Promise<string> {
  if (!isInteractive()) return "";
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise<string>((res) => rl.question(question, (a) => res(a.trim())));
  } finally {
    rl.close();
  }
}

/**
 * Yes/no confirmation. Non-interactive sessions (CI, pipes) return `fallback`
 * instead of hanging on stdin.
 */
export async function confirm(message: string, fallback = true): Promise<boolean> {
  if (!isInteractive()) return fallback;
  const answer = (await ask(`${message} [Y/n] `)).toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}
