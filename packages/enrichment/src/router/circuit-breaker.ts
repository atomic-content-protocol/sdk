/**
 * CircuitBreaker — protects downstream LLM calls from cascading failures.
 *
 * States:
 *   CLOSED   — normal operation; all requests pass through.
 *   OPEN     — too many failures; requests are rejected immediately.
 *   HALF_OPEN — after resetTimeout, one probe request is allowed.
 *
 * Differences from Stacklist's original:
 *   - No Sentry / captureError dependency — uses optional `onTrip` callback.
 *   - No logger dependency — uses optional `onStateChange` callback.
 *   - No ExternalServiceError — throws plain `Error` with descriptive messages.
 *   - No getRequestId() — not needed outside of HTTP middleware contexts.
 */

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before tripping OPEN. Default: 5. */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before probing. Default: 30 000. */
  resetTimeoutMs?: number;
  /** Per-request timeout in milliseconds. Default: 30 000. */
  requestTimeoutMs?: number;
  /**
   * Called once when the circuit trips from CLOSED/HALF_OPEN → OPEN.
   * Useful for metrics, structured logging, or alerting.
   */
  onTrip?: (name: string, failures: number) => void;
  /**
   * Called on every state transition.
   * Provides the breaker name, previous state, and new state.
   */
  onStateChange?: (name: string, from: string, to: string) => void;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly onTrip?: (name: string, failures: number) => void;
  private readonly onStateChange?: (
    name: string,
    from: string,
    to: string
  ) => void;

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
   * Applies a per-request timeout and tracks failures to trip the circuit.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.resetTimeoutMs) {
        const remaining = Math.ceil((this.resetTimeoutMs - elapsed) / 1_000);
        throw new Error(
          `Circuit breaker "${this.name}" is OPEN (${this.failures} failures, resets in ${remaining}s)`
        );
      }
      this.transitionTo("HALF_OPEN");
    }

    try {
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `Circuit breaker "${this.name}" request timed out after ${this.requestTimeoutMs}ms`
            )
          );
        }
      }, this.requestTimeoutMs);

      fn().then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        }
      );
    });
  }

  private onSuccess(): void {
    if (this.state !== "CLOSED") {
      this.transitionTo("CLOSED");
    }
    this.failures = 0;
  }

  private onFailure(error?: unknown): void {
    this.failures += 1;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.transitionTo("OPEN");
      this.onTrip?.(this.name, this.failures);
    }
  }

  private transitionTo(newState: CircuitState): void {
    const prev = this.state;
    this.state = newState;
    this.onStateChange?.(this.name, prev, newState);
  }
}
