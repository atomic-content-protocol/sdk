import { describe, it, expect } from "vitest";
import { generateId } from "./id.js";

// RFC 4122 / RFC 9562 UUID format
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("generateId", () => {
  it("returns a string matching the UUID format", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(UUID_REGEX);
  });

  it("generates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId()));
    // All 20 should be unique
    expect(ids.size).toBe(20);
  });

  it("two consecutive IDs are different", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it("generates UUID v7 (version nibble is '7')", () => {
    // UUID v7 format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    // The version nibble is the first character of the third group
    const id = generateId();
    const parts = id.split("-");
    expect(parts[2]).toMatch(/^7/);
  });

  it("IDs are time-sortable: an ID generated later sorts after an earlier one", async () => {
    // UUID v7 encodes a millisecond timestamp in the first 48 bits,
    // so lexicographic order corresponds to creation order.
    // We insert a small async yield to allow the clock to advance.
    const id1 = generateId();

    // Yield to the event loop a few times to ensure clock advancement
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const id2 = generateId();

    // Lexicographic comparison: id2 should be >= id1
    // (could be equal in same ms, but should never be less)
    expect(id2.localeCompare(id1)).toBeGreaterThanOrEqual(0);
  });

  it("returns lowercase hex characters", () => {
    const id = generateId();
    // Remove dashes, check all remaining chars are lowercase hex
    const hex = id.replace(/-/g, "");
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});
