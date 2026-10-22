import type { Ranked } from "./bm25.js";

/**
 * Reciprocal Rank Fusion: score = Σ 1 / (rrfK + rank), rank counted from 0, over every list that
 * contains the document. Uses ranks only, so BM25 scores and cosine distances never need normalising.
 */
export function rrfFuse(lists: Ranked[][], rrfK: number): Ranked[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((r, rank) => score.set(r.id, (score.get(r.id) ?? 0) + 1 / (rrfK + rank)));
  return [...score.entries()].map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
