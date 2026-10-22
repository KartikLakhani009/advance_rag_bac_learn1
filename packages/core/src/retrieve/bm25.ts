import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import type { Chunk } from "../schemas.js";
import { matchesFilter, type Filter } from "./filters.js";

export interface Ranked {
  id: string;
  score: number;
}

/** What gets embedded and BM25-indexed: heading path plus text when a heading path exists. */
export function embeddedText(c: Pick<Chunk, "headingPath" | "text">): string {
  return c.headingPath ? `${c.headingPath}\n${c.text}` : c.text;
}

const OPTIONS = {
  fields: ["text"],
  storeFields: ["kind", "region", "chapter"],
  idField: "id",
} as const;

export function buildBm25(chunks: Chunk[]): MiniSearch {
  const ms = new MiniSearch({ ...OPTIONS, fields: [...OPTIONS.fields], storeFields: [...OPTIONS.storeFields] });
  ms.addAll(chunks.map((c) => ({ id: c.id, text: embeddedText(c), kind: c.kind, region: c.region, chapter: c.chapter })));
  return ms;
}

export function saveBm25(ms: MiniSearch, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ms));
}

export function loadBm25(file: string): MiniSearch {
  return MiniSearch.loadJSON(fs.readFileSync(file, "utf8"), {
    ...OPTIONS,
    fields: [...OPTIONS.fields],
    storeFields: [...OPTIONS.storeFields],
  });
}

/** BM25 top-k with the same filter semantics as the Chroma `where`. */
export function bm25Search(ms: MiniSearch, query: string, k: number, filter?: Filter): Ranked[] {
  const res = ms.search(query, {
    combineWith: "OR",
    filter: (r) => matchesFilter({ kind: r.kind, region: r.region, chapter: r.chapter }, filter),
  });
  return res.slice(0, k).map((r) => ({ id: String(r.id), score: r.score }));
}
