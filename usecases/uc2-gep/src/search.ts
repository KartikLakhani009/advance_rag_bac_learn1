import type { Ranked } from "@rag/core/src/retrieve/bm25.js";
import type { SearchIndex, SearchMode } from "@rag/core/src/retrieve/searcher.js";
import { toFilter, type Routing } from "./regions.js";

/** Fewer hits than this inside the filter means the filter probably hid the answer: search the whole report. */
export const MIN_FILTER_HITS = 3;

const NONE: Routing = { region: null, chapter: null, executive_summary: false, box: false };

export interface FilteredSearch {
  shortlist: Ranked[];
  /** true when the filter was applied and kept (≥3 hits) */
  usedFilter: boolean;
  fellBack: boolean;
  hasConstraint: boolean;
}

/** Search inside the routing filter; fewer than MIN_FILTER_HITS hits → search the whole report without it. Noise is always excluded. */
export async function searchFiltered(
  index: SearchIndex,
  mode: SearchMode,
  query: string,
  routing: Routing,
  k: number,
  rrfK: number,
): Promise<FilteredSearch> {
  const hasConstraint = !!(routing.region || routing.chapter || routing.executive_summary || routing.box);
  const shortlist = await index.search(mode, query, k, rrfK, toFilter(routing));
  if (hasConstraint && shortlist.length < MIN_FILTER_HITS) {
    return { shortlist: await index.search(mode, query, k, rrfK, toFilter(NONE)), usedFilter: false, fellBack: true, hasConstraint };
  }
  return { shortlist, usedFilter: hasConstraint, fellBack: false, hasConstraint };
}
