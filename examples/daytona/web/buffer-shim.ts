/**
 * `gray-matter` calls `Buffer.from` while parsing a string, even though the
 * page never touches a filesystem. This is only `from` for strings.
 */

const encoder = new TextEncoder();

const BufferShim = {
  from(input: string): Uint8Array {
    return encoder.encode(input);
  },
  isBuffer(value: unknown): boolean {
    return value instanceof Uint8Array;
  },
};

(globalThis as { Buffer?: typeof BufferShim }).Buffer = BufferShim;
