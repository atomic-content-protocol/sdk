import { describe, expect, it } from "vitest";
import { RateLimiter, SpendGuard } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("consumes weighted units and refuses when the weight does not fit", () => {
    const t = 0;
    const rl = new RateLimiter({ limit: 5, now: () => t });
    expect(rl.consume("a", 3)).toMatchObject({ allowed: true, remaining: 2 });
    expect(rl.consume("a", 3)).toMatchObject({ allowed: false, remaining: 2 });
    expect(rl.consume("a", 2)).toMatchObject({ allowed: true, remaining: 0 });
    expect(rl.consume("a")).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("isolates keys and resets after the window", () => {
    let t = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.consume("a").allowed).toBe(true);
    expect(rl.consume("b").allowed).toBe(true);
    expect(rl.consume("a").allowed).toBe(false);
    t = 1001;
    expect(rl.consume("a").allowed).toBe(true);
  });

  it("peek never consumes", () => {
    const rl = new RateLimiter({ limit: 2 });
    expect(rl.peek("a").remaining).toBe(2);
    expect(rl.peek("a").remaining).toBe(2);
    rl.consume("a");
    expect(rl.peek("a").remaining).toBe(1);
  });

  it("bounds the number of tracked keys by evicting the oldest", () => {
    let t = 0;
    const rl = new RateLimiter({ limit: 10, maxKeys: 3, now: () => t });
    rl.consume("k1");
    t += 1;
    rl.consume("k2");
    t += 1;
    rl.consume("k3");
    t += 1;
    rl.consume("k4");
    expect(rl.size).toBe(3);
    // k1 (oldest) was evicted, so it starts fresh
    expect(rl.peek("k1").remaining).toBe(10);
    expect(rl.peek("k4").remaining).toBe(9);
  });

  it("sweeps expired keys", () => {
    let t = 0;
    const rl = new RateLimiter({ limit: 1, windowMs: 10, now: () => t });
    rl.consume("a");
    t = 61_000; // past window and past sweep interval
    rl.consume("b");
    expect(rl.size).toBe(1);
  });
});

describe("SpendGuard", () => {
  it("reserves up to the cap and releases", () => {
    const g = new SpendGuard(1.0);
    expect(g.tryReserve(0.6)).toBe(true);
    expect(g.tryReserve(0.5)).toBe(false);
    g.release(0.2);
    expect(g.tryReserve(0.5)).toBe(true);
    expect(g.spentToday).toBeCloseTo(0.9);
  });

  it("is disabled with an infinite cap", () => {
    const g = new SpendGuard(Number.POSITIVE_INFINITY);
    expect(g.tryReserve(1e9)).toBe(true);
  });

  it("rolls over at the UTC day boundary", () => {
    let t = Date.UTC(2026, 0, 1, 23, 59, 0);
    const g = new SpendGuard(1, () => t);
    expect(g.tryReserve(1)).toBe(true);
    expect(g.tryReserve(0.1)).toBe(false);
    t = Date.UTC(2026, 0, 2, 0, 1, 0);
    expect(g.tryReserve(0.1)).toBe(true);
  });
});
