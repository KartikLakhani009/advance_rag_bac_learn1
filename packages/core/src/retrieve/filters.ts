import type { Where } from "chromadb";
import type { Chunk, ChunkKind } from "../schemas.js";

/** One filter, applied identically to Chroma (`where`) and MiniSearch (predicate). */
export interface Filter {
  region?: string;
  chapter?: number;
  kinds?: ChunkKind[];
  excludeKinds?: ChunkKind[];
}

export type FilterMeta = Pick<Chunk, "kind" | "region" | "chapter">;

export function matchesFilter(m: Partial<FilterMeta>, f: Filter | undefined): boolean {
  if (!f) return true;
  if (f.region !== undefined && m.region !== f.region) return false;
  if (f.chapter !== undefined && m.chapter !== f.chapter) return false;
  if (f.kinds && (!m.kind || !f.kinds.includes(m.kind))) return false;
  if (f.excludeKinds && m.kind && f.excludeKinds.includes(m.kind)) return false;
  return true;
}

export function toChromaWhere(f: Filter | undefined): Where | undefined {
  if (!f) return undefined;
  const conds: Where[] = [];
  if (f.region !== undefined) conds.push({ region: f.region });
  if (f.chapter !== undefined) conds.push({ chapter: f.chapter });
  if (f.kinds) conds.push({ kind: { $in: f.kinds } });
  if (f.excludeKinds?.length) conds.push({ kind: { $nin: f.excludeKinds } });
  if (conds.length === 0) return undefined;
  return conds.length === 1 ? conds[0]! : { $and: conds };
}
