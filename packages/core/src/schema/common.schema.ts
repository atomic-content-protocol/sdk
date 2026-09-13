import { z } from "zod";

/**
 * Schema fragments shared by ACO, Container and Collection frontmatter.
 * Defined once here so the three object types cannot drift apart.
 */

/**
 * AuthorSchema — who created the object (§3.2).
 * `id` is implementation-specific (email, handle, DID, …).
 */
export const AuthorSchema = z
  .object({
    /** Unique identifier for the author. Format is implementation-specific. */
    id: z.string().min(1),
    /** Human-readable display name. */
    name: z.string().min(1),
  })
  .passthrough();

export type Author = z.infer<typeof AuthorSchema>;

/**
 * TokenCountsSchema — per-tokenizer token counts (§3.6).
 *
 * All keys are optional; implementations populate what they can compute.
 * On a Container or Collection this is the aggregate over contained objects.
 */
export const TokenCountsSchema = z
  .object({
    /** OpenAI cl100k_base tokenizer (GPT-4, GPT-3.5-turbo, text-embedding-3-*). */
    cl100k: z.number().int().nonnegative().optional(),
    /** Anthropic Claude tokenizer (via SDK count_tokens()). */
    claude: z.number().int().nonnegative().optional(),
    /** Meta Llama 3/4 tokenizer (via HuggingFace AutoTokenizer). */
    llama3: z.number().int().nonnegative().optional(),
    /** Heuristic estimate (e.g. chars/4). For display purposes. */
    approximate: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type TokenCounts = z.infer<typeof TokenCountsSchema>;
