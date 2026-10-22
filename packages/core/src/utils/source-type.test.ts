import { describe, expect, it } from "vitest";
import { getEnrichmentStrategy, MIN_BODY_LENGTH_FOR_ENRICHMENT, SOURCE_TYPE_MODALITY } from "./source-type.js";

// A body long enough to trigger conditional enrichment
const LONG_BODY = "a".repeat(MIN_BODY_LENGTH_FOR_ENRICHMENT);
// A body just below the threshold
const SHORT_BODY = "a".repeat(MIN_BODY_LENGTH_FOR_ENRICHMENT - 1);

const TEXT_AND_DOCUMENT_TYPES = ["manual", "uploaded_md", "link", "converted_pdf", "converted_doc"] as const;

describe("SOURCE_TYPE_MODALITY", () => {
  it("maps text-native types to 'text'", () => {
    for (const st of ["link", "uploaded_md", "manual", "selected_text", "llm_capture"] as const) {
      expect(SOURCE_TYPE_MODALITY[st]).toBe("text");
    }
  });

  it("maps converted document types to 'document'", () => {
    expect(SOURCE_TYPE_MODALITY["converted_pdf"]).toBe("document");
    expect(SOURCE_TYPE_MODALITY["converted_doc"]).toBe("document");
  });

  it("maps uploaded_image to 'image'", () => {
    expect(SOURCE_TYPE_MODALITY["uploaded_image"]).toBe("image");
  });

  it("maps converted_video to 'video'", () => {
    expect(SOURCE_TYPE_MODALITY["converted_video"]).toBe("video");
  });
});

describe("getEnrichmentStrategy — text/document types", () => {
  for (const st of TEXT_AND_DOCUMENT_TYPES) {
    it(`${st}: all enrichment enabled for a body at the threshold, no fixed classification`, () => {
      const s = getEnrichmentStrategy(st, LONG_BODY);
      expect(s.language).toBe(true);
      expect(s.summary).toBe(true);
      expect(s.textEnrichment).toBe(true);
      expect(s.classificationDefault).toBeNull();
    });

    it(`${st}: empty body disables summary, textEnrichment and language`, () => {
      const s = getEnrichmentStrategy(st, "");
      expect(s.summary).toBe(false);
      expect(s.textEnrichment).toBe(false);
      expect(s.language).toBe(false);
      expect(s.classificationDefault).toBeNull();
    });

    it(`${st}: body below the threshold disables summary, textEnrichment and language`, () => {
      const s = getEnrichmentStrategy(st, SHORT_BODY);
      expect(s.summary).toBe(false);
      expect(s.textEnrichment).toBe(false);
      expect(s.language).toBe(false);
      expect(s.classificationDefault).toBeNull();
    });
  }

  it("manual with an empty body: nothing is inferred (LAB-1527 acceptance)", () => {
    const s = getEnrichmentStrategy("manual", "");
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
    expect(s.language).toBe(false);
  });

  it("uploaded_md with a short body: nothing is inferred (LAB-1527 acceptance)", () => {
    const s = getEnrichmentStrategy("uploaded_md", "short");
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
    expect(s.language).toBe(false);
  });

  it("a ten-character placeholder body is gated", () => {
    const s = getEnrichmentStrategy("manual", "TODO: body");
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
    expect(s.language).toBe(false);
  });

  it("whitespace padding does not lift a short body over the threshold", () => {
    const padded = `${" ".repeat(40)}short${" ".repeat(40)}`;
    expect(padded.length).toBeGreaterThan(MIN_BODY_LENGTH_FOR_ENRICHMENT);
    const s = getEnrichmentStrategy("manual", padded);
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
    expect(s.language).toBe(false);
  });
});

describe("getEnrichmentStrategy — uploaded_image", () => {
  it("disables language, summary, and textEnrichment", () => {
    const s = getEnrichmentStrategy("uploaded_image", "");
    expect(s.language).toBe(false);
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
  });

  it("sets classificationDefault to 'image'", () => {
    const s = getEnrichmentStrategy("uploaded_image", "");
    expect(s.classificationDefault).toBe("image");
  });

  it("body content does not change strategy (images have no text body)", () => {
    const withBody = getEnrichmentStrategy("uploaded_image", LONG_BODY);
    expect(withBody.language).toBe(false);
    expect(withBody.textEnrichment).toBe(false);
    expect(withBody.classificationDefault).toBe("image");
  });
});

describe("getEnrichmentStrategy — converted_video", () => {
  it("no transcript: all conditional fields disabled", () => {
    const s = getEnrichmentStrategy("converted_video", "");
    expect(s.language).toBe(false);
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
  });

  it("no transcript: classificationDefault is 'video'", () => {
    const s = getEnrichmentStrategy("converted_video", "");
    expect(s.classificationDefault).toBe("video");
  });

  it("short body (below threshold): still treated as no transcript", () => {
    const s = getEnrichmentStrategy("converted_video", SHORT_BODY);
    expect(s.language).toBe(false);
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
  });

  it("body at exactly the threshold: enrichment enabled", () => {
    const s = getEnrichmentStrategy("converted_video", LONG_BODY);
    expect(s.language).toBe(true);
    expect(s.summary).toBe(true);
    expect(s.textEnrichment).toBe(true);
  });

  it("transcript body: classificationDefault remains 'video' (not inferred from text)", () => {
    const s = getEnrichmentStrategy("converted_video", LONG_BODY);
    expect(s.classificationDefault).toBe("video");
  });
});

describe("getEnrichmentStrategy — unknown source_type", () => {
  it("falls back to 'text' strategy without crashing", () => {
    // Cast needed to simulate runtime malformed frontmatter
    const s = getEnrichmentStrategy("unknown_future_type" as any, LONG_BODY);
    expect(s.language).toBe(true);
    expect(s.textEnrichment).toBe(true);
    expect(s.classificationDefault).toBeNull();
  });

  it("falls back to 'text' gating too: a short body is not inferred from", () => {
    const s = getEnrichmentStrategy("unknown_future_type" as any, "some body");
    expect(s.language).toBe(false);
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
  });

  it("returns text strategy for empty unknown type", () => {
    const s = getEnrichmentStrategy("" as any, "");
    expect(s.classificationDefault).toBeNull();
  });
});

describe("MIN_BODY_LENGTH_FOR_ENRICHMENT boundary", () => {
  const atThreshold = "x".repeat(MIN_BODY_LENGTH_FOR_ENRICHMENT);
  const belowThreshold = "x".repeat(MIN_BODY_LENGTH_FOR_ENRICHMENT - 1);

  it("body of exactly MIN_BODY_LENGTH_FOR_ENRICHMENT triggers enrichment for video", () => {
    const s = getEnrichmentStrategy("converted_video", atThreshold);
    expect(s.language).toBe(true);
  });

  it("body of MIN_BODY_LENGTH_FOR_ENRICHMENT - 1 does not trigger enrichment for video", () => {
    const s = getEnrichmentStrategy("converted_video", belowThreshold);
    expect(s.language).toBe(false);
  });

  it("body of exactly MIN_BODY_LENGTH_FOR_ENRICHMENT enables every field for text", () => {
    const s = getEnrichmentStrategy("manual", atThreshold);
    expect(s.language).toBe(true);
    expect(s.summary).toBe(true);
    expect(s.textEnrichment).toBe(true);
  });

  it("body of MIN_BODY_LENGTH_FOR_ENRICHMENT - 1 disables every field for text", () => {
    const s = getEnrichmentStrategy("manual", belowThreshold);
    expect(s.language).toBe(false);
    expect(s.summary).toBe(false);
    expect(s.textEnrichment).toBe(false);
  });

  it("the threshold counts trimmed characters", () => {
    const s = getEnrichmentStrategy("manual", `  ${belowThreshold}  `);
    expect(s.summary).toBe(false);
  });
});
