import { buildQueryResult, toRanked, type GeneratedAnswer } from "../answer.js";
import { loadManifest } from "../assets/manifest.js";
import type { Ranked } from "../retrieve/bm25.js";
import type { SearchIndex } from "../retrieve/searcher.js";
import type { Chunk, QueryResult } from "../schemas.js";
import { usageSnapshot } from "../usage.js";
import type { AskOutput } from "./app.js";

/** What every query graph ends with. */
export interface GraphState {
  question: string;
  shortlist: Ranked[];
  final: Ranked[];
  passages: Chunk[];
  generated: GeneratedAnswer;
  trace: QueryResult["trace"];
  /** absent for use cases that never rerank */
  rerankUsed?: boolean;
  rerankError?: string;
}

/** Turn a finished graph state into the validated `QueryResult` plus the ranked list the eval scores. */
export function toAskOutput(args: {
  uc: string;
  state: GraphState;
  index: SearchIndex;
  rerankModel: string;
  filters?: Record<string, unknown> | null;
  rewrittenQuery?: string | null;
}): AskOutput {
  const { state: s, index } = args;
  const rerankUsed = s.rerankUsed ?? false;
  const result = buildQueryResult({
    question: s.question,
    passages: s.passages,
    generated: s.generated,
    manifest: loadManifest(args.uc),
    uc: args.uc,
    trace: s.trace,
    debug: {
      filters: args.filters ?? null,
      rewrittenQuery: args.rewrittenQuery ?? null,
      shortlist: s.shortlist.map((r) => toRanked(index.chunk(r.id), r.score)),
      final: s.final.map((r) => toRanked(index.chunk(r.id), r.score)),
      rerankUsed,
      rerankModel: rerankUsed ? args.rerankModel : null,
      usage: usageSnapshot(),
    },
  });
  return {
    result,
    ranked: s.final.map((r) => ({ chunk: index.chunk(r.id), score: r.score })),
    passages: s.passages,
    rerankUsed,
    rerankError: s.rerankError,
  };
}
