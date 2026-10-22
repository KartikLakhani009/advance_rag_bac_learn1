import type * as mupdf from "mupdf";
import { extractAll, openPdf, type RawPage } from "./extract.js";
import { findRepeatedFurniture, mergeDropCaps, readingOrder, removeFurniture, type Line } from "./layout.js";
import { detectPrintedPage, printedFromPdf, type DocKey } from "./pages.js";
import { lineTextWithFootnotes } from "./footnotes.js";

export interface DocLine extends Line {
  /** footnote-marked, NFKC-normalised, not yet Th-repaired (repair needs the doc vocabulary) */
  clean: string;
  notes: number[];
  printedPage: string;
}

export interface DocPage {
  page: number;
  printedPage: string;
  /** printed number actually found in the header/footer band (undefined = inferred) */
  detectedPrinted?: string;
  lines: DocLine[];
  raw: RawPage;
}

export interface LoadedDoc {
  key: DocKey;
  file: string;
  pdf: mupdf.Document;
  pages: DocPage[];
}

/** Open a PDF and run layout: furniture removal → reading order → footnote markers. */
export function loadDocument(key: DocKey, file: string): LoadedDoc {
  const pdf = openPdf(file);
  const raws = extractAll(pdf);
  const furniture = findRepeatedFurniture(raws);
  const pages: DocPage[] = raws.map((raw) => {
    const detected = detectPrintedPage(raw);
    // The offset table is the source of truth (spec section 5): some documents print no number on a page and
    // detection can catch a stray figure. `detectedPrinted` is kept as a cross-check.
    const printedPage = printedFromPdf(key, raw.page);
    const kept = removeFurniture(raw, furniture);
    const ordered = mergeDropCaps(readingOrder(raw, kept));
    const lines: DocLine[] = ordered.map((l) => {
      const { text, notes } = lineTextWithFootnotes(l);
      return { ...l, clean: text.normalize("NFKC"), notes, printedPage };
    });
    return { page: raw.page, printedPage, detectedPrinted: detected, lines, raw };
  });
  return { key, file, pdf, pages };
}
