import type { Chunk, QueryResult } from "../schemas.js";

export interface AskOutput {
  result: QueryResult;
  /** final ranked chunks before any parent swap, with scores */
  ranked: Array<{ chunk: Chunk; score: number }>;
  /** passages actually given to the LLM (after parent swap in UC2) */
  passages: Chunk[];
  rerankUsed: boolean;
  rerankError?: string;
}

export interface UseCaseApp {
  ask(question: string): Promise<AskOutput>;
}
