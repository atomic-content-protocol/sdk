/**
 * CircuitBreaker — protects downstream LLM calls from cascading failures.
 *
 * States:
 *   CLOSED    — normal operation; all requests pass through.
 *   OPEN      — too many failures; requests are rejected immediately.
 *   HALF_OPEN — after resetTimeout, exactly one probe request is allowed.
 *               Concurrent callers are rejected until the probe settles.
 *               Probe success → CLOSED; probe failure → OPEN again.
 *
 * Every call runs under a per-request timeout. The wrapped function receives
 * an `AbortSignal` that fires on timeout so the underlying HTTP request is
 * actually cancelled rather than left running (and billing) in the background.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before tripping OPEN. Default: 5. */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before probing. Default: 30 000. */
  resetTimeoutMs?: number;
  /** Per-request timeout in milliseconds. Default: 30 000. */
  requestTimeoutMs?: number;
  /**
   * Called every time the circuit trips to OPEN — from CLOSED after
   * `failureThreshold` consecutive failures, or from HALF_OPEN after a failed
   * probe. Useful for metrics, structured logging, or alerting.
   */
  onTrip?: (name: string, failures: number) => void;
  /**
   * Called on every state transition.
   * Provides the breaker name, previous state, and new state.
   */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
}

/** Error thrown when the breaker refuses a call without executing it. */
export class CircuitOpenError extends Error {
  readonly breaker: string;
  readonly state: CircuitState;

  constructor(breaker: string, state: CircuitState, message: string) {
    super(message);
    this.name = "CircuitOpenError";
    this.breaker = breaker;
    this.state = state;
  }
}

/** Error thrown when a call exceeds `requestTimeoutMs`. */
export class CircuitTimeoutError extends Error {
  readonly breaker: string;
  readonly timeoutMs: number;

  constructor(breaker: string, timeoutMs: number) {
    super(`Circuit breaker "${breaker}" request timed out after ${timeoutMs}ms`);
    this.name = "CircuitTimeoutError";
    this.breaker = breaker;
    this.timeoutMs = timeoutMs;
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;
  private probeInFlight = false;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly onTrip?: (name: string, failures: number) => void;
  private readonly onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.onTrip = options.onTrip;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Execute an async function through the circuit breaker.
   *
   * `fn` receives an AbortSignal that is aborted when the per-request timeout
   * fires; pass it to the HTTP client so the request is cancelled.
   */
  async execute<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.admit();

    const isProbe = this.state === "HALF_OPEN";
    if (isProbe) this.probeInFlight = true;

    try {
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      if (isProbe) this.probeInFlight = false;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Consecutive failures since the last success. */
  getFailureCount(): number {
    return this.failures;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Decide whether a call may proceed; transitions OPEN → HALF_OPEN when due. */
  private admit(): void {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.resetTimeoutMs) {
        const remaining = Math.ceil((this.resetTimeoutMs - elapsed) / 1_000);
        throw new CircuitOpenError(
          this.name,
          "OPEN",
          `Circuit breaker "${this.name}" is OPEN (${this.failures} failures, resets in ${remaining}s)`
        );
      }
      this.transitionTo("HALF_OPEN");
    }

    if (this.state === "HALF_OPEN" && this.probeInFlight) {
      throw new CircuitOpenError(
        this.name,
        "HALF_OPEN",
        `Circuit breaker "${this.name}" is HALF_OPEN and a probe is already in flight`
      );
    }
  }

  private async executeWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new CircuitTimeoutError(this.name, this.requestTimeoutMs);
        controller.abort(err);
        reject(err);
      }, this.requestTimeoutMs);
    });

    try {
      return await Promise.race([fn(controller.signal), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state !== "CLOSED") {
      this.transitionTo("CLOSED");
    }
  }

  private onFailure(): void {
    this.failures += 1;
    this.lastFailureTime = Date.now();

    // A failed probe re-opens immediately; otherwise trip at the threshold.
    if (this.state === "HALF_OPEN" || this.failures >= this.failureThreshold) {
      if (this.state !== "OPEN") {
        this.transitionTo("OPEN");
        this.onTrip?.(this.name, this.failures);
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const prev = this.state;
    if (prev === newState) return;
    this.state = newState;
    this.onStateChange?.(this.name, prev, newState);
  }
}
