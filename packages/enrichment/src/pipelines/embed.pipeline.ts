import type { ACO } from "@acp/core";
import type { IEnrichmentProvider } from "../providers/provider.interface.js";
import type {
  IEnrichmentPipeline,
  EnrichmentResult,
  EnrichmentOptions,
} from "./pipeline.interface.js";
import { createProvenanceRecord } from "../utils/provenance.js";

/**
 * Maximum body length (in characters) passed to the embedding model.
 *
 * Most embedding models cap at ~8 192 tokens. 8 000 characters is a
 * conservative character-level proxy that keeps us safely under that limit
 * for typical prose regardless of tokeniser.
 */
const MAX_BODY_CHARS = 8_000;

/**
 * EmbedPipeline — generates a vector embedding for an ACO's content.
 *
 * The vector itself is returned in `EnrichmentResult.embedding` so callers
 * can persist it to a vector store of their choice. It is intentionally NOT
 * written into `frontmatter` — embedding arrays (1 536+ floats for
 * text-embedding-3-small) are far too large for YAML frontmatter.
 *
 * What IS written to `frontmatter.provenance.embedding` is a standard
 * provenance record that records which model produced the embedding and when,
 * enabling idempotency checks on subsequent runs.
 *
 * Idempotent: skips re-embedding if a provenance record for "embedding"
 * already exists in the ACO, unless `options.force` is true.
 */
export class EmbedPipeline implements IEnrichmentPipeline {
  readonly name = "embed";
  readonly field = "embedding";

  async enrich(
    aco: ACO,
    provider: IEnrichmentProvider,
    options?: EnrichmentOptions
  ): Promise<EnrichmentResult> {
    if (!provider.embed) {
      throw new Error(
        `Provider "${provider.name}" does not support embeddings. ` +
          `Use a provider that implements the embed() method (e.g. OpenAIProvider or OllamaProvider).`
      );
    }

    const { frontmatter, body } = aco;

    // Idempotency check — skip if provenance record for "embedding" exists
    const existingProvenance = (
      frontmatter["provenance"] as Record<string, unknown> | undefined
    )?.["embedding"];
    if (existingProvenance && !options?.force) {
      return {
        aco,
        fieldUpdated: this.field,
        confidence: 0,
        model: "skipped",
      };
    }

    // Build the text to embed: title + truncated body
    const title = String(frontmatter["title"] ?? "").trim();
    const truncatedBody = body.slice(0, MAX_BODY_CHARS);
    const textToEmbed = title ? `${title}\n\n${truncatedBody}` : truncatedBody;

    // Generate the embedding vector
    const vector = await provider.embed(textToEmbed);

    // Write a provenance record to frontmatter so subsequent runs can skip
    const provRecord = createProvenanceRecord(provider.model, 1.0);

    const updatedFrontmatter: Record<string, unknown> = {
      ...frontmatter,
      provenance: {
        ...(frontmatter["provenance"] as Record<string, unknown> | undefined),
        embedding: provRecord,
      },
    };

    return {
      aco: { frontmatter: updatedFrontmatter, body },
      fieldUpdated: this.field,
      confidence: 1.0,
      model: provider.model,
      embedding: vector,
    };
  }
}
