import type { Element } from "../schemas.js";
import type { DocLine, DocPage, LoadedDoc } from "./document.js";
import { toParagraphs } from "./layout.js";
import { buildVocab, joinLines, repairText, type Vocab } from "./repair.js";

export interface BuiltPage {
  page: number;
  printedPage: string;
  elements: Element[];
}

export interface BuiltDoc {
  vocab: Vocab;
  pages: BuiltPage[];
}

/**
 * Lines → repaired paragraph elements, one reading-ordered list per page.
 * The vocabulary is built from the whole document so hyphen joins and the "Th" ligature fix can tell
 * real words from damaged ones.
 */
export function buildElements(doc: LoadedDoc): BuiltDoc {
  const vocab = buildVocab(doc.pages.flatMap((p) => p.lines.map((l) => l.clean)));
  const pages = doc.pages.map((p) => ({ page: p.page, printedPage: p.printedPage, elements: pageElements(p, vocab) }));
  return { vocab, pages };
}

export function pageElements(p: DocPage, vocab: Vocab): Element[] {
  return (toParagraphs(p.lines) as DocLine[][]).map((para, i) => {
    const text = repairText(
      joinLines(
        para.map((l) => l.clean),
        vocab,
      ),
      vocab,
    );
    const first = para[0]!;
    return {
      id: `p${p.page}-e${i}`,
      page: p.page,
      printedPage: p.printedPage,
      kind: "paragraph" as const,
      text,
      font: first.font.replace(/^[A-Z]{6}\+/, ""),
      size: first.size,
      bold: first.bold,
      bbox: {
        x0: Math.min(...para.map((l) => l.x0)),
        y0: Math.min(...para.map((l) => l.y0)),
        x1: Math.max(...para.map((l) => l.x1)),
        y1: Math.max(...para.map((l) => l.y1)),
      },
      column: first.column,
    };
  });
}

/** Raw mupdf text per page — the naive baseline's input (no reading order, no repair, headers kept). */
export function rawPageTexts(doc: LoadedDoc): Array<{ page: number; printedPage: string; text: string }> {
  return doc.pages.map((p) => ({ page: p.page, printedPage: p.printedPage, text: p.raw.lines.map((l) => l.text).join(" ") }));
}
