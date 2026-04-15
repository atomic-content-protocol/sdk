import { describe, it, expect } from "vitest";
import { approximateTokenCount, computeTokenCounts } from "./token-count.js";

describe("approximateTokenCount", () => {
  it("returns ceil(length / 4) for a typical string", () => {
    // "hello world" = 11 chars → ceil(11/4) = 3
    expect(approximateTokenCount("hello world")).toBe(3);
  });

  it("returns 0 for an empty string", () => {
    expect(approximateTokenCount("")).toBe(0);
  });

  it("rounds up (ceiling) for non-multiples of 4", () => {
    // 1 char → ceil(1/4) = 1
    expect(approximateTokenCount("a")).toBe(1);
    // 5 chars → ceil(5/4) = 2
    expect(approximateTokenCount("hello")).toBe(2);
    // 8 chars → ceil(8/4) = 2
    expect(approximateTokenCount("abcdefgh")).toBe(2);
    // 9 chars → ceil(9/4) = 3
    expect(approximateTokenCount("abcdefghi")).toBe(3);
  });

  it("returns exact value for multiples of 4", () => {
    // 4 chars → 1 token
    expect(approximateTokenCount("abcd")).toBe(1);
    // 12 chars → 3 tokens
    expect(approximateTokenCount("abcdefghijkl")).toBe(3);
  });

  it("scales proportionally for longer text", () => {
    const text = "a".repeat(400);
    expect(approximateTokenCount(text)).toBe(100);
  });
});

describe("computeTokenCounts", () => {
  it("returns an object with at least the approximate field", async () => {
    const counts = await computeTokenCounts("hello world");
    expect(counts).toHaveProperty("approximate");
    expect(typeof counts.approximate).toBe("number");
  });

  it("approximate matches approximateTokenCount", async () => {
    const text = "This is a test sentence for token counting.";
    const counts = await computeTokenCounts(text);
    expect(counts.approximate).toBe(approximateTokenCount(text));
  });

  it("returns approximate: 0 for empty string", async () => {
    const counts = await computeTokenCounts("");
    expect(counts.approximate).toBe(0);
  });

  it("approximate is a non-negative integer", async () => {
    const counts = await computeTokenCounts("Some text content here.");
    expect(counts.approximate).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(counts.approximate)).toBe(true);
  });

  it("returns consistent results on repeated calls with same input", async () => {
    const text = "Consistency check for token counting.";
    const counts1 = await computeTokenCounts(text);
    const counts2 = await computeTokenCounts(text);
    expect(counts1.approximate).toBe(counts2.approximate);
  });

  it("longer text produces more tokens than shorter text", async () => {
    const short = await computeTokenCounts("short");
    const longer = await computeTokenCounts(
      "This is a much longer sentence with many more tokens in it."
    );
    expect(longer.approximate).toBeGreaterThan(short.approximate);
  });
});
