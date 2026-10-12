import type { AskAnswer } from "@/lib/jev/ask/types";

/**
 * Seam for an optional LLM narrator. Jev decides and ranks; a narrator would
 * only rephrase an already-grounded answer into prose (citing `evidence`).
 * Deliberately unimplemented — set `narrator` to plug one in.
 */
export type Narrator = (answer: AskAnswer, signal?: AbortSignal) => Promise<string | null>;

export const narrator: Narrator | null = null;
