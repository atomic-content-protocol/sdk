import ora, { type Ora } from "ora";

/**
 * Spinners keep an interval alive and redraw the line; if a command throws
 * while one is spinning the process never exits and the error is erased.
 * Every spinner is created through here so the top-level error handler can
 * stop them all before printing.
 */
const active = new Set<Ora>();

export function startSpinner(text: string): Ora {
  const s = ora({ text, stream: process.stderr });
  const stop = s.stop.bind(s);
  const succeed = s.succeed.bind(s);
  const fail = s.fail.bind(s);
  const warn = s.warn.bind(s);
  const release = () => active.delete(s);
  s.stop = () => {
    release();
    return stop();
  };
  s.succeed = (t?: string) => {
    release();
    return succeed(t);
  };
  s.fail = (t?: string) => {
    release();
    return fail(t);
  };
  s.warn = (t?: string) => {
    release();
    return warn(t);
  };
  active.add(s);
  return s.start();
}

/** Stop every spinner still running (called on the error path). */
export function stopAllSpinners(): void {
  for (const s of active) s.stop();
  active.clear();
}
