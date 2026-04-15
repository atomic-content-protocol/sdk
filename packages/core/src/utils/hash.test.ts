import { describe, it, expect } from "vitest";
import { normalizeBody, computeContentHash } from "./hash.js";

describe("normalizeBody", () => {
  it("converts CRLF (\\r\\n) to LF (\\n)", () => {
    const result = normalizeBody("line one\r\nline two\r\nline three");
    expect(result).toBe("line one\nline two\nline three");
  });

  it("converts bare CR (\\r) to LF (\\n)", () => {
    const result = normalizeBody("line one\rline two");
    expect(result).toBe("line one\nline two");
  });

  it("trims leading and trailing whitespace", () => {
    const result = normalizeBody("   hello world   ");
    expect(result).toBe("hello world");
  });

  it("trims leading and trailing newlines", () => {
    const result = normalizeBody("\n\ncontent\n\n");
    expect(result).toBe("content");
  });

  it("preserves internal whitespace after trimming", () => {
    const result = normalizeBody("  first line\n  second line  ");
    expect(result).toBe("first line\n  second line");
  });

  it("applies NFC Unicode normalization", () => {
    // 'é' can be represented as U+00E9 (NFC) or U+0065 U+0301 (NFD)
    const nfd = "\u0065\u0301"; // e + combining accent = é in NFD
    const nfc = "\u00E9";       // é in NFC
    expect(normalizeBody(nfd)).toBe(nfc);
  });

  it("handles empty string without error", () => {
    const result = normalizeBody("");
    expect(result).toBe("");
  });

  it("handles mixed CRLF and LF in same string", () => {
    const result = normalizeBody("line1\r\nline2\nline3\r\nline4");
    expect(result).toBe("line1\nline2\nline3\nline4");
  });
});

describe("computeContentHash", () => {
  it("returns a string prefixed with 'sha256:'", () => {
    const hash = computeContentHash("hello world");
    expect(hash).toMatch(/^sha256:/);
  });

  it("returns a lowercase hex string after the sha256: prefix", () => {
    const hash = computeContentHash("test content");
    const hex = hash.replace(/^sha256:/, "");
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it("returns a 64-character hex digest (SHA-256 = 32 bytes = 64 hex chars)", () => {
    const hash = computeContentHash("any content");
    const hex = hash.replace(/^sha256:/, "");
    expect(hex).toHaveLength(64);
  });

  it("produces the same hash for the same content (stability)", () => {
    const content = "The quick brown fox jumps over the lazy dog";
    const hash1 = computeContentHash(content);
    const hash2 = computeContentHash(content);
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different content", () => {
    const hash1 = computeContentHash("content A");
    const hash2 = computeContentHash("content B");
    expect(hash1).not.toBe(hash2);
  });

  it("produces the same hash for \\r\\n and \\n (cross-platform normalization)", () => {
    const withCRLF = "line one\r\nline two\r\nline three";
    const withLF = "line one\nline two\nline three";
    expect(computeContentHash(withCRLF)).toBe(computeContentHash(withLF));
  });

  it("produces the same hash for content with leading/trailing whitespace vs trimmed", () => {
    const withPadding = "  hello world  ";
    const withoutPadding = "hello world";
    expect(computeContentHash(withPadding)).toBe(computeContentHash(withoutPadding));
  });

  it("handles empty string input", () => {
    const hash = computeContentHash("");
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
