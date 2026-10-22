import path from "node:path";
import { attachEndnotes, notesAboutTitle, withEndnotes } from "@rag/core/src/chunking/elements.js";
import { flowToUnits } from "@rag/core/src/chunking/flow.js";
import { naiveChunks } from "@rag/core/src/chunking/naive.js";
import { sentenceChunks, type SentenceUnit } from "@rag/core/src/chunking/sentence.js";
import { RAW_DIR } from "@rag/core/src/config.js";
import { loadDocument, type DocPage, type LoadedDoc } from "@rag/core/src/pdf/document.js";
import { buildElements, pageElements, rawPageTexts, type BuiltDoc } from "@rag/core/src/pdf/elements.js";
import { parseEndnotes } from "@rag/core/src/pdf/footnotes.js";
import { buildVocab, joinLines, repairText } from "@rag/core/src/pdf/repair.js";
import { formatRow, inTableArea, rebuildTables, type RebuiltTable } from "@rag/core/src/pdf/tables.js";
import { countTokens } from "@rag/core/src/text/tokens.js";
import type { Chunk, Element } from "@rag/core/src/schemas.js";

export const UC = "uc3";
export const PDF = path.join(RAW_DIR, "iMac_PER_Oct2024.pdf");
export const ENDNOTE_PAGES = [11, 12];
export const PROSE_PAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export interface Uc3Doc {
  doc: LoadedDoc;
  built: BuiltDoc;
  tables: Map<number, RebuiltTable[]>;
  endnotes: Map<number, string>;
}

export function loadUc3(): Uc3Doc {
  const doc = loadDocument("imac", PDF);
  const built = buildElements(doc);
  const tables = new Map<number, RebuiltTable[]>();
  for (const p of doc.pages) tables.set(p.page, rebuildTables(p));
  return { doc, built, tables, endnotes: loadEndnotes(doc, tables) };
}

/** Endnotes 1–19 from pages 11–12: lines outside table areas and outside the legal footer, in reading order. */
export function loadEndnotes(doc: LoadedDoc, tables: Map<number, RebuiltTable[]>): Map<number, string> {
  const lines: string[] = [];
  for (const n of ENDNOTE_PAGES) {
    const p = doc.pages[n - 1]!;
    const ts = tables.get(n) ?? [];
    for (const l of p.lines) {
      if (l.size >= 20) continue; // "Endnotes" title
      if (inTableArea(l, ts)) continue;
      if (l.size <= 6.1 && l.y0 > p.raw.height * 0.9) continue; // legal footer
      lines.push(l.clean.replace(/\s+/g, " ").trim());
    }
  }
  // glue hyphenated line breaks the same way the body does, then parse "n text …"
  const vocab = buildVocab(lines);
  const joined: string[] = [];
  for (const raw of lines) {
    const prev = joined[joined.length - 1];
    if (prev !== undefined && /[A-Za-z]-$/.test(prev) && /^[a-z]/.test(raw)) joined[joined.length - 1] = joinLines([prev, raw], vocab);
    else joined.push(raw);
  }
  return new Map([...parseEndnotes(joined, 19)].map(([k, v]) => [k, repairText(v, vocab)]));
}

export function buildNaive(u: Uc3Doc): Chunk[] {
  return naiveChunks(rawPageTexts(u.doc), 1000, "uc3-naive");
}

/** The whole-document sentence stream, UC1 recipe (ladder step 2): sentences, ~450 tokens, overlap 60. */
export function buildSentenceRecipe(u: Uc3Doc): Chunk[] {
  const items = u.built.pages.flatMap((p) => p.elements.map((el) => ({ el, page: p.page, printedPage: p.printedPage })));
  return sentenceChunks(flowToUnits(items, u.built.vocab), { targetTokens: 450, overlapTokens: 60, idPrefix: "uc3-s", kind: "sentence" });
}

function pageWithoutTables(p: DocPage, ts: RebuiltTable[]): DocPage {
  return { ...p, lines: p.lines.filter((l) => !inTableArea(l, ts)) };
}

const isHeading = (e: Element) => (e.size ?? 0) >= 14 && !!e.bold;
const isPageTitle = (e: Element) => (e.size ?? 0) >= 20 && !!e.bold;

/** The page's 24pt title ("Carbon" + "Footprint" → "Carbon Footprint"); context for every chunk on the page. */
export function pageTitle(els: Element[]): string {
  return els
    .filter(isPageTitle)
    .map((e) => e.text.trim())
    .join(" ")
    .trim();
}

export interface ElementChunkSet {
  /** prose groups + whole-table chunks (what the LLM reads) */
  chunks: Chunk[];
  /** one chunk per table row, each pointing at its table (small-to-big retrieval) */
  rows: Chunk[];
}

/**
 * Element chunks: rebuilt tables (kind "table", one per table, with the endnotes their markers point at AND the
 * endnotes whose text starts with the table title), per-row chunks (kind "table_row", parentId = table), and prose
 * groups per page and heading (kind "text", up to ~220 tokens). Prose inside a table area (±6pt) is excluded.
 * Every chunk's heading path starts with the page title. Pages 11–12 are not chunked as prose.
 */
export function buildElementChunkSet(u: Uc3Doc): ElementChunkSet {
  const chunks: Chunk[] = [];
  const rows: Chunk[] = [];
  for (const page of u.doc.pages) {
    const ts = u.tables.get(page.page) ?? [];
    const allEls = pageElements(page, u.built.vocab);
    // the endnote pages are titled "Endnotes", which says nothing about the power table that sits on page 12
    const title = ENDNOTE_PAGES.includes(page.page) ? "" : pageTitle(allEls);
    ts.forEach((t, i) => {
      const headingPath = [title, t.title].filter(Boolean).join(" > ");
      const id = `uc3-t${page.page}-${i}`;
      const base: Chunk = {
        id,
        kind: "table",
        text: t.text,
        page: page.page,
        pageEnd: page.page,
        printedPage: page.printedPage,
        printedPageEnd: page.printedPage,
        headingPath,
        assetIds: [],
        tokens: countTokens(t.text),
        endsOnSentence: true,
      };
      chunks.push(withEndnotes(base, u.endnotes, notesAboutTitle(t.title, u.endnotes)));
      t.rows.forEach((r, ri) => {
        const text = formatRow(t, r);
        rows.push(
          withEndnotes({ ...base, id: `${id}-r${ri}`, kind: "table_row", text, tokens: countTokens(text), parentId: id }, u.endnotes),
        );
      });
    });
    if (!PROSE_PAGES.includes(page.page)) continue;

    const els = pageElements(pageWithoutTables(page, ts), u.built.vocab);
    let sub: string | undefined;
    let run: Element[] = [];
    const runs: Array<{ sub?: string; els: Element[] }> = [];
    const flush = () => {
      if (run.length) runs.push({ sub, els: run });
      run = [];
    };
    for (const e of els) {
      if (isPageTitle(e)) continue;
      if (isHeading(e)) {
        flush();
        sub = e.text.trim();
        continue;
      }
      run.push(e);
    }
    flush();
    runs.forEach((r, ri) => {
      const units: SentenceUnit[] = flowToUnits(
        r.els.map((el) => ({ el, page: page.page, printedPage: page.printedPage })),
        u.built.vocab,
      );
      const headingPath = [title, r.sub].filter(Boolean).join(" > ") || undefined;
      for (const c of sentenceChunks(units, { targetTokens: 220, overlapTokens: 0, idPrefix: `uc3-p${page.page}-${ri}`, kind: "text" })) {
        chunks.push(withEndnotes({ ...c, headingPath }, u.endnotes));
      }
    });
  }
  return { chunks, rows };
}

/** Backwards-compatible: prose groups + whole tables (ladder steps 3–5). */
export function buildElementChunks(u: Uc3Doc): Chunk[] {
  return buildElementChunkSet(u).chunks;
}

/** Vision chunks write footnotes as "[note n]"; convert to the [^n] form so endnote linking treats them like body text. */
export function visionNotesToMarkers(text: string): string {
  return text.replace(/\[note\s+(\d+)\]/gi, "[^$1]");
}

export { attachEndnotes };
