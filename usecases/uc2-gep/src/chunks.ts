import path from "node:path";
import { naiveChunks } from "@rag/core/src/chunking/naive.js";
import { buildHierarchy } from "@rag/core/src/chunking/hierarchy.js";
import { RAW_DIR } from "@rag/core/src/config.js";
import { loadDocument, type LoadedDoc } from "@rag/core/src/pdf/document.js";
import { buildElements, rawPageTexts, type BuiltDoc } from "@rag/core/src/pdf/elements.js";
import type { Chunk, ParentChunk } from "@rag/core/src/schemas.js";
import { structureDocument, tableLabels, CHAPTERS, type Structured } from "./structure.js";

export const UC = "uc2";
export const PDF = path.join(RAW_DIR, "GEP-Jun-2026.pdf");

export interface Uc2Doc {
  doc: LoadedDoc;
  built: BuiltDoc;
  structured: Structured;
}

export function loadUc2(): Uc2Doc {
  const doc = loadDocument("gep", PDF);
  const built = buildElements(doc);
  return { doc, built, structured: structureDocument(doc, built) };
}

export function buildNaive(u: Uc2Doc): Chunk[] {
  return naiveChunks(rawPageTexts(u.doc), 1000, "uc2-naive");
}

const SEARCHABLE = new Set(["body", "box", "executive_summary"]);

/** Parents (~900 tokens) and children (~280 tokens, 40 overlap) inside each searchable section. */
export function buildHier(u: Uc2Doc): { parents: ParentChunk[]; children: Chunk[] } {
  return buildHierarchy(
    u.structured.sections.filter((s) => SEARCHABLE.has(s.meta.kind)),
    { parentTokens: 900, childTokens: 280, childOverlap: 40 },
  );
}

/** Chunks of non-searchable kinds (references, front matter) for transparency; never indexed. */
export function buildNoiseSummary(u: Uc2Doc): { kind: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of u.structured.sections.filter((x) => !SEARCHABLE.has(x.meta.kind)))
    m.set(s.meta.kind, (m.get(s.meta.kind) ?? 0) + s.units.length);
  for (const n of u.structured.noise) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
  return [...m.entries()].map(([kind, count]) => ({ kind, count }));
}

/** Table chunk metadata for a vision-listed page: chapter/region at the end of that page, heading `… > South Asia > Table 2.10`. */
export function tableMeta(u: Uc2Doc, page: number): Partial<Chunk> & { headingPath: string } {
  const ctx = u.structured.pageContext.get(page) ?? {};
  const labels = tableLabels(u.doc, page);
  const parts = [
    ctx.chapter ? `Chapter ${ctx.chapter}: ${CHAPTERS[ctx.chapter]}` : undefined,
    ctx.region,
    labels.length ? labels.join(", ") : "Table",
  ].filter(Boolean);
  return {
    chapter: ctx.chapter,
    chapterTitle: ctx.chapter ? CHAPTERS[ctx.chapter] : undefined,
    region: ctx.region,
    headingPath: parts.join(" > "),
  };
}

/** Same chunks without the heading path: ladder step 2 (section-aware chunks, nothing embedded but text). */
export function stripHeadingPath(chunks: Chunk[]): Chunk[] {
  return chunks.map((c) => ({ ...c, headingPath: undefined }));
}
