import type {
  IEnrichmentProvider,
  CompletionOptions,
  StructuredSchema,
} from "../providers/provider.interface.js";

/**
 * Helpers that always tell the caller which model actually produced a
 * result. When the provider is a `ProviderRouter` this is the model of the
 * entry that answered after fallback — not the first configured one — so
 * provenance records stay truthful.
 */

export interface WithModel<T> {
  result: T;
  model: string;
}

export async function completeWithModel(
  provider: IEnrichmentProvider,
  prompt: string,
  options?: CompletionOptions
): Promise<WithModel<string>> {
  if (provider.completeWithMeta) {
    const { result, model } = await provider.completeWithMeta(prompt, options);
    return { result, model };
  }
  return { result: await provider.complete(prompt, options), model: provider.model };
}

export async function structuredCompleteWithModel<T>(
  provider: IEnrichmentProvider,
  prompt: string,
  schema: StructuredSchema,
  options?: CompletionOptions
): Promise<WithModel<T>> {
  if (provider.structuredCompleteWithMeta) {
    const { result, model } = await provider.structuredCompleteWithMeta<T>(prompt, schema, options);
    return { result, model };
  }
  return { result: await provider.structuredComplete<T>(prompt, schema, options), model: provider.model };
}

export async function embedWithModel(
  provider: IEnrichmentProvider,
  text: string,
  options?: { signal?: AbortSignal }
): Promise<WithModel<number[]>> {
  if (provider.embedWithMeta) {
    const { result, model } = await provider.embedWithMeta(text, options);
    return { result, model };
  }
  if (!provider.embed) {
    throw new Error(`Provider "${provider.name}" does not support embeddings`);
  }
  return {
    result: await provider.embed(text, options),
    model: provider.embeddingModel ?? provider.model,
  };
}
