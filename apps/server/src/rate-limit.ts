/**
 * In-memory fixed-window rate limiter keyed by client identity (API key or IP).
 *
 * Weighted: a call can consume more than one unit (a batch of N items costs
 * N units) so the limit reflects actual LLM spend rather than HTTP requests.
 * The MCP handshake (`initialize`, `tools/list`) costs nothing.
 *
 * Bounded: the store never holds more than `MAX_KEYS` entries; when full, the
 * oldest-expiring entry is evicted so an attacker rotating source addresses
 * cannot grow memory without limit.
 *
 * Single-process only. Put a shared store (Redis) behind this interface when
 * running more than one replica.
 */

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  /** Units allowed per window. */
  limit: number;
  /** Window length in ms. Default 1 hour. */
  windowMs?: number;
  /** Maximum distinct keys tracked. Default 10 000. */
  maxKeys?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export class RateLimiter {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs ?? 60 * 60 * 1000;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Peek at the current state for `key` without consuming units. */
  peek(key: string): RateLimitDecision {
    const now = this.now();
    const entry = this.store.get(key);
    if (!entry || now > entry.resetAt) {
      return { allowed: true, limit: this.limit, remaining: this.limit, resetAt: now + this.windowMs };
    }
    return {
      allowed: entry.count < this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      resetAt: entry.resetAt,
    };
  }

  /**
   * Try to consume `weight` units for `key`. If the whole weight does not fit
   * in the remaining budget nothing is consumed and `allowed` is false.
   */
  consume(key: string, weight = 1): RateLimitDecision {
    const now = this.now();
    this.sweep(now);

    let entry = this.store.get(key);
    if (!entry || now > entry.resetAt) {
      if (!entry && this.store.size >= this.maxKeys) this.evictOldest();
      entry = { count: 0, resetAt: now + this.windowMs };
      this.store.set(key, entry);
    }

    const units = Math.max(1, Math.floor(weight));
    if (entry.count + units > this.limit) {
      return { allowed: false, limit: this.limit, remaining: Math.max(0, this.limit - entry.count), resetAt: entry.resetAt };
    }

    entry.count += units;
    return { allowed: true, limit: this.limit, remaining: this.limit - entry.count, resetAt: entry.resetAt };
  }

  /** Number of tracked keys (for tests / diagnostics). */
  get size(): number {
    return this.store.size;
  }

  private lastSweep = 0;

  /** Drop expired entries, at most once a minute. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(key);
    }
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestReset = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.store) {
      if (entry.resetAt < oldestReset) {
        oldestReset = entry.resetAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) this.store.delete(oldestKey);
  }
}

/**
 * Daily spend guard. Tracks estimated USD spent since the start of the
 * current UTC day; `tryReserve` refuses once the cap would be exceeded.
 * A cap of `Infinity` disables the guard.
 */
export class SpendGuard {
  private day = "";
  private spent = 0;

  constructor(
    private readonly capUsd: number,
    private readonly now: () => number = Date.now
  ) {}

  private roll(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
    }
  }

  /** Reserve `usd` against today's budget. Returns false (and reserves nothing) if over cap. */
  tryReserve(usd: number): boolean {
    this.roll();
    if (!Number.isFinite(this.capUsd)) return true;
    if (this.spent + usd > this.capUsd) return false;
    this.spent += usd;
    return true;
  }

  /** Give back a reservation for work that did not happen. */
  release(usd: number): void {
    this.roll();
    this.spent = Math.max(0, this.spent - usd);
  }

  get spentToday(): number {
    this.roll();
    return this.spent;
  }

  get cap(): number {
    return this.capUsd;
  }
}
