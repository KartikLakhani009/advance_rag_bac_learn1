import type { Chunk, ChunkKind, ParentChunk } from "../schemas.js";
import { countTokens } from "../text/tokens.js";
import { endsOnSentenceBoundary } from "../text/sentences.js";
import { windowSentences, type SentenceUnit } from "./sentence.js";

export interface SectionMeta {
  headingPath?: string;
  chapter?: number;
  chapterTitle?: string;
  region?: string;
  box?: string;
  kind: ChunkKind;
}

export interface Section {
  id: string;
  meta: SectionMeta;
  units: SentenceUnit[];
}

export interface HierarchyOptions {
  parentTokens: number;
  childTokens: number;
  childOverlap: number;
}

function make(id: string, slice: SentenceUnit[], meta: SectionMeta, extra: Partial<Chunk> = {}): Chunk {
  const text = slice.map((u) => u.text).join(" ");
  const first = slice[0]!;
  const last = slice[slice.length - 1]!;
  return {
    id,
    kind: meta.kind,
    text,
    page: first.page,
    pageEnd: last.page,
    printedPage: first.printedPage,
    printedPageEnd: last.printedPage,
    headingPath: meta.headingPath,
    chapter: meta.chapter,
    chapterTitle: meta.chapterTitle,
    region: meta.region,
    box: meta.box,
    assetIds: [],
    tokens: countTokens(text),
    endsOnSentence: endsOnSentenceBoundary(text),
    ...extra,
  };
}

/**
 * Parents are ~900-token sentence windows inside one section (what the LLM reads); children are ~280-token
 * pieces of a parent with 40-token overlap (what we search). A section is never crossed.
 */
export function buildHierarchy(sections: Section[], opts: HierarchyOptions): { parents: ParentChunk[]; children: Chunk[] } {
  const parents: ParentChunk[] = [];
  const children: Chunk[] = [];
  for (const sec of sections) {
    if (sec.units.length === 0) continue;
    const pw = windowSentences(sec.units, { targetTokens: opts.parentTokens, overlapTokens: 0 });
    pw.forEach(([a, b], pi) => {
      const pslice = sec.units.slice(a, b);
      const pid = `${sec.id}-p${pi}`;
      const parent = make(pid, pslice, sec.meta);
      const cw = windowSentences(pslice, { targetTokens: opts.childTokens, overlapTokens: opts.childOverlap });
      const childIds: string[] = [];
      cw.forEach(([ca, cb], ci) => {
        const id = `${pid}-c${ci}`;
        childIds.push(id);
        children.push(make(id, pslice.slice(ca, cb), sec.meta, { parentId: pid }));
      });
      parents.push({ ...parent, childIds });
    });
  }
  return { parents, children };
}
