import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  describe('initial state', () => {
    it('starts CLOSED', () => {
      const cb = new CircuitBreaker('test');
      expect(cb.getState()).toBe('CLOSED');
    });
  });

  describe('CLOSED state — success path', () => {
    it('passes through on success and returns the result', async () => {
      const cb = new CircuitBreaker('test');
      const result = await cb.execute(async () => 'hello');
      expect(result).toBe('hello');
      expect(cb.getState()).toBe('CLOSED');
    });

    it('remains CLOSED after a single failure below threshold', async () => {
      const cb = new CircuitBreaker('test', { failureThreshold: 3 });
      await expect(cb.execute(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      expect(cb.getState()).toBe('CLOSED');
    });
  });

  describe('failure counting → OPEN transition', () => {
    it('transitions to OPEN after reaching the failure threshold', async () => {
      const cb = new CircuitBreaker('test', { failureThreshold: 3 });
      const fail = () => cb.execute(async () => { throw new Error('fail'); });

      await expect(fail()).rejects.toThrow();
      await expect(fail()).rejects.toThrow();
      await expect(fail()).rejects.toThrow();

      expect(cb.getState()).toBe('OPEN');
    });

    it('calls onTrip once when the circuit trips', async () => {
      const onTrip = vi.fn();
      const cb = new CircuitBreaker('svc', { failureThreshold: 2, onTrip });
      const fail = () => cb.execute(async () => { throw new Error('fail'); });

      await expect(fail()).rejects.toThrow();
      await expect(fail()).rejects.toThrow();

      expect(onTrip).toHaveBeenCalledOnce();
      expect(onTrip).toHaveBeenCalledWith('svc', 2);
    });

    it('calls onStateChange with correct from/to values', async () => {
      const onStateChange = vi.fn();
      const cb = new CircuitBreaker('svc', { failureThreshold: 1, onStateChange });
      await expect(cb.execute(async () => { throw new Error('x'); })).rejects.toThrow();

      expect(onStateChange).toHaveBeenCalledWith('svc', 'CLOSED', 'OPEN');
    });
  });

  describe('OPEN state', () => {
    it('rejects immediately without executing the function', async () => {
      const cb = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 60_000 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');

      const fn = vi.fn(async () => 'never called');
      await expect(cb.execute(fn)).rejects.toThrow(/OPEN/);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('OPEN → HALF_OPEN after resetTimeout', () => {
    it('transitions to HALF_OPEN after resetTimeoutMs has elapsed', async () => {
      const cb = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 1 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');

      // Wait for the reset timeout to elapse
      await new Promise((r) => setTimeout(r, 5));

      // Trigger the state-check logic by attempting a call that succeeds
      await cb.execute(async () => 'probe');
      // After a successful probe the breaker resets to CLOSED
      expect(cb.getState()).toBe('CLOSED');
    });
  });

  describe('HALF_OPEN → CLOSED on success', () => {
    it('resets to CLOSED after a successful probe call', async () => {
      const cb = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 1 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();

      await new Promise((r) => setTimeout(r, 5));

      const result = await cb.execute(async () => 42);
      expect(result).toBe(42);
      expect(cb.getState()).toBe('CLOSED');
    });

    it('resets failure count so subsequent failures start from 0', async () => {
      const cb = new CircuitBreaker('test', { failureThreshold: 2, resetTimeoutMs: 1 });

      // Trip the breaker
      const fail = () => cb.execute(async () => { throw new Error('fail'); });
      await expect(fail()).rejects.toThrow();
      await expect(fail()).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');

      // Wait for reset
      await new Promise((r) => setTimeout(r, 5));

      // Successful probe → CLOSED
      await cb.execute(async () => 'ok');
      expect(cb.getState()).toBe('CLOSED');

      // One failure should NOT trip again (count is reset)
      await expect(fail()).rejects.toThrow('fail');
      expect(cb.getState()).toBe('CLOSED');
    });
  });
});
