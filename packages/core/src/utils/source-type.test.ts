import { describe, it, expect } from "vitest";
import {
  SOURCE_TYPE_MODALITY,
  MODALITY_ENRICHMENT,
  MIN_BODY_LENGTH_FOR_ENRICHMENT,
  getEnrichmentStrategy,
} from "./source-type.js";

// A body long enough to trigger conditional enrichment
const LONG_BODY = "a".repeat(MIN_BODY_LENGTH_FOR_ENRICHMENT);
// A body just below the threshold
const SHORT_BODY = "a".repeat(MIN_BODY_LENGTH_FOR_ENRICHMENT - 1);

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
  for (const st of ["manual", "uploaded_md", "link", "converted_pdf", "converted_doc"] as const) {
    it(`${st}: all enrichment enabled, no fixed classification`, () => {
      const s = getEnrichmentStrategy(st, "some meaningful body content here and more words");
      expect(s.language).toBe(true);
      expect(s.summary).toBe(true);
      expect(s.textEnrichment).toBe(true);
      expect(s.classificationDefault).toBeNull();
    });
  }
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
    const s = getEnrichmentStrategy("unknown_future_type" as any, "some body");
    expect(s.language).toBe(true);
    expect(s.textEnrichment).toBe(true);
    expect(s.classificationDefault).toBeNull();
  });

  it("returns text strategy for empty unknown type", () => {
    const s = getEnrichmentStrategy("" as any, "");
    expect(s.classificationDefault).toBeNull();
  });
});

describe("MIN_BODY_LENGTH_FOR_ENRICHMENT boundary", () => {
  it("body of exactly MIN_BODY_LENGTH_FOR_ENRICHMENT triggers enrichment for video", () => {
    const atThreshold = "x".repeat(MIN_BODY_LENGTH_FOR_ENRICHMENT);
    const s = getEnrichmentStrategy("converted_video", atThreshold);
    expect(s.language).toBe(true);
  });

  it("body of MIN_BODY_LENGTH_FOR_ENRICHMENT - 1 does not trigger enrichment for video", () => {
    const belowThreshold = "x".repeat(MIN_BODY_LENGTH_FOR_ENRICHMENT - 1);
    const s = getEnrichmentStrategy("converted_video", belowThreshold);
    expect(s.language).toBe(false);
  });
});
