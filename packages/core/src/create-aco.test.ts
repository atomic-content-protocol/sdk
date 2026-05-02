import { describe, it, expect } from "vitest";
import { createACO } from "./index.js";

const AUTHOR = { id: "user-1", name: "Test User" };

describe("createACO — uploaded_image", () => {
  it("omits content_hash", async () => {
    const aco = await createACO({
      title: "photo.jpeg",
      source_type: "uploaded_image",
      author: AUTHOR,
    });
    expect(aco.frontmatter["content_hash"]).toBeUndefined();
  });

  it("omits token_counts", async () => {
    const aco = await createACO({
      title: "photo.jpeg",
      source_type: "uploaded_image",
      author: AUTHOR,
    });
    expect(aco.frontmatter["token_counts"]).toBeUndefined();
  });

  it("two image ACOs with no body get different ids (not deduplicated)", async () => {
    const a = await createACO({ source_type: "uploaded_image", author: AUTHOR });
    const b = await createACO({ source_type: "uploaded_image", author: AUTHOR });
    expect(a.frontmatter["id"]).not.toBe(b.frontmatter["id"]);
  });

  it("still sets id, acp_version, object_type, created, author, source_type", async () => {
    const aco = await createACO({
      title: "photo.jpeg",
      source_type: "uploaded_image",
      author: AUTHOR,
    });
    expect(aco.frontmatter["id"]).toBeTruthy();
    expect(aco.frontmatter["acp_version"]).toBe("0.2");
    expect(aco.frontmatter["object_type"]).toBe("aco");
    expect(aco.frontmatter["source_type"]).toBe("uploaded_image");
    expect(aco.frontmatter["author"]).toEqual(AUTHOR);
    expect(typeof aco.frontmatter["created"]).toBe("string");
  });

  it("caller-supplied content_hash in frontmatter is preserved", async () => {
    const fileHash = "sha256:abc123def456";
    const aco = await createACO({
      title: "photo.jpeg",
      source_type: "uploaded_image",
      author: AUTHOR,
      frontmatter: { content_hash: fileHash },
    });
    expect(aco.frontmatter["content_hash"]).toBe(fileHash);
  });
});

describe("createACO — converted_video (no transcript)", () => {
  it("omits content_hash", async () => {
    const aco = await createACO({
      title: "recording.mp4",
      source_type: "converted_video",
      author: AUTHOR,
    });
    expect(aco.frontmatter["content_hash"]).toBeUndefined();
  });

  it("omits token_counts when body is below threshold", async () => {
    const aco = await createACO({
      title: "recording.mp4",
      body: "short",
      source_type: "converted_video",
      author: AUTHOR,
    });
    expect(aco.frontmatter["token_counts"]).toBeUndefined();
  });
});

describe("createACO — converted_video (with transcript)", () => {
  const LONG_TRANSCRIPT = "This is a full transcript of the video recording. ".repeat(5);

  it("still omits content_hash (always omitted for video)", async () => {
    const aco = await createACO({
      title: "recording.mp4",
      body: LONG_TRANSCRIPT,
      source_type: "converted_video",
      author: AUTHOR,
    });
    expect(aco.frontmatter["content_hash"]).toBeUndefined();
  });

  it("includes token_counts when transcript body meets threshold", async () => {
    const aco = await createACO({
      title: "recording.mp4",
      body: LONG_TRANSCRIPT,
      source_type: "converted_video",
      author: AUTHOR,
    });
    expect(aco.frontmatter["token_counts"]).toBeDefined();
    const tc = aco.frontmatter["token_counts"] as { approximate: number };
    expect(tc.approximate).toBeGreaterThan(0);
  });
});

describe("createACO — text types (regression)", () => {
  it("uploaded_md includes content_hash and token_counts", async () => {
    const aco = await createACO({
      title: "doc.md",
      body: "# Hello\n\nThis is content.",
      source_type: "uploaded_md",
      author: AUTHOR,
    });
    expect(typeof aco.frontmatter["content_hash"]).toBe("string");
    expect((aco.frontmatter["content_hash"] as string).startsWith("sha256:")).toBe(true);
    expect(aco.frontmatter["token_counts"]).toBeDefined();
  });

  it("manual includes content_hash and token_counts", async () => {
    const aco = await createACO({
      body: "Some manually entered content.",
      source_type: "manual",
      author: AUTHOR,
    });
    expect(typeof aco.frontmatter["content_hash"]).toBe("string");
    expect(aco.frontmatter["token_counts"]).toBeDefined();
  });
});
