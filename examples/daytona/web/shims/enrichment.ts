/**
 * Browser stand-in for the enrichment package barrel.
 * `find_similar` imports pipeline helpers but does not call them when
 * `hasEnrichment` is false. The real barrel pulls the Anthropic and OpenAI
 * SDKs. Node `check-web.ts` still imports the real package.
 */

export const PIPELINE_NAMES = ["tag", "summary", "entity", "classification", "unified", "embed"] as const;
export type PipelineName = (typeof PIPELINE_NAMES)[number];

export function buildPipeline(): never {
  throw new Error("enrichment pipelines are not used by the browser benchmark");
}

export function needsPipeline(): boolean {
  return false;
}

export function pipelinesNeeded(): PipelineName[] {
  return [];
}
