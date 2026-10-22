import type { Chunk, ParentChunk } from "../schemas.js";

export interface ParentSwap {
  passages: Chunk[];
  swapped: number;
}

/**
 * Swap ranked children for their parents: dedupe by parent (first/best child wins, rank order kept), cap at
 * `max`. A chunk without a parentId is its own parent (table chunks).
 */
export function swapChildrenForParents(children: Chunk[], parents: Map<string, ParentChunk | Chunk>, max = 3): ParentSwap {
  const seen = new Set<string>();
  const passages: Chunk[] = [];
  let swapped = 0;
  for (const c of children) {
    const pid = c.parentId ?? c.id;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const parent = c.parentId ? parents.get(c.parentId) : c;
    if (c.parentId) swapped++;
    passages.push(parent ?? c);
    if (passages.length >= max) break;
  }
  return { passages, swapped };
}
