/**
 * CliError — a failure the user can act on. Printed as a one-line message
 * (no stack trace) and mapped to the given exit code.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    readonly hint?: string
  ) {
    super(message);
    this.name = "CliError";
  }
}

export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  /** Validation found invalid documents. */
  INVALID: 3,
  /** Enrichment providers not configured. */
  NO_PROVIDER: 4,
} as const;
