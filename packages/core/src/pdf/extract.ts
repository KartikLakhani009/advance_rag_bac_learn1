import * as mupdf from "mupdf";
import fs from "node:fs";

/** One run of characters with identical font, size and baseline. */
export interface Span {
  text: string;
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  baseline: number;
}

export interface RawLine {
  spans: Span[];
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  baseline: number;
  /** dominant span (most chars) */
  font: string;
  size: number;
  bold: boolean;
  blockId: number;
}

export interface RawBlock {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RawImage {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RawRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** fill colour as 0..1 components */
  color: number[];
}

export interface RawPage {
  /** 1-based PDF page */
  page: number;
  width: number;
  height: number;
  lines: RawLine[];
  blocks: RawBlock[];
  images: RawImage[];
  /** filled rectangles / vector shapes from drawings */
  rects: RawRect[];
}

/** fz_bound_path accepts NULL for fills; the mupdf typings insist on a StrokeState. */
const FILL_ONLY = null as unknown as mupdf.StrokeState;

export function openPdf(file: string): mupdf.Document {
  return mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
}

export function pageCount(doc: mupdf.Document): number {
  return doc.countPages();
}

/** Extract one page (1-based) into typed lines/spans, images and filled vectors. */
export function extractPage(doc: mupdf.Document, pageNo: number): RawPage {
  const page = doc.loadPage(pageNo - 1);
  const [bx0, by0, bx1, by1] = page.getBounds();
  const st = page.toStructuredText("preserve-whitespace,preserve-images");

  const lines: RawLine[] = [];
  const blocks: RawBlock[] = [];
  const images: RawImage[] = [];
  const rects: RawRect[] = [];

  let blockId = -1;
  let curSpans: Span[] = [];
  let curBox: number[] = [0, 0, 0, 0];
  let curSpan: Span | null = null;

  const flushSpan = () => {
    if (curSpan && curSpan.text.length > 0) curSpans.push(curSpan);
    curSpan = null;
  };

  st.walk({
    beginTextBlock(bbox: mupdf.Rect) {
      blockId++;
      blocks.push({ id: blockId, x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3] });
    },
    beginLine(bbox: mupdf.Rect) {
      curSpans = [];
      curSpan = null;
      curBox = [...bbox];
    },
    onChar(c: string, origin: mupdf.Point, font: mupdf.Font, size: number, quad: mupdf.Quad) {
      const name = font.getName();
      const baseline = origin[1];
      const sz = Math.round(size * 10) / 10;
      const cs = curSpan;
      if (!cs || cs.font !== name || cs.size !== sz || Math.abs(cs.baseline - baseline) > 0.8) {
        flushSpan();
        curSpan = {
          text: "",
          font: name,
          size: sz,
          bold: font.isBold() || /bold|semibold|black|heavy/i.test(name),
          italic: font.isItalic(),
          x0: quad[0],
          y0: quad[1],
          x1: quad[2],
          y1: quad[5],
          baseline,
        };
      }
      const s = curSpan as Span;
      s.text += c;
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      s.x0 = Math.min(s.x0, ...xs);
      s.x1 = Math.max(s.x1, ...xs);
      s.y0 = Math.min(s.y0, ...ys);
      s.y1 = Math.max(s.y1, ...ys);
    },
    endLine() {
      flushSpan();
      const spans = curSpans.filter((s) => s.text.trim().length > 0 || s.text.length > 0);
      if (spans.length === 0 || spans.every((s) => s.text.trim() === "")) return;
      const dom = spans.reduce((best, sp) => (sp.text.trim().length > best.text.trim().length ? sp : best));
      lines.push({
        spans,
        text: spans
          .map((s) => s.text)
          .join("")
          .replace(/\s+$/g, ""),
        x0: curBox[0]!,
        y0: curBox[1]!,
        x1: curBox[2]!,
        y1: curBox[3]!,
        baseline: dom.baseline,
        font: dom.font,
        size: dom.size,
        bold: dom.bold,
        blockId,
      });
    },
    onImageBlock(bbox: mupdf.Rect) {
      images.push({ x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3] });
    },
  });

  // Filled shapes (table header bars, chart bars) come from the drawing device, not stext.
  const dev = new mupdf.Device({
    fillPath(path: mupdf.Path, _eo: boolean, ctm: mupdf.Matrix, cs: mupdf.ColorSpace, color: number[]) {
      const b = path.getBounds(FILL_ONLY, ctm);
      let rgb = [...color];
      try {
        if (cs.getNumberOfComponents() === 1) rgb = [color[0]!, color[0]!, color[0]!];
        else if (cs.getNumberOfComponents() === 4) {
          const [c, m, y, k] = color as [number, number, number, number];
          rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
        }
      } catch {
        /* keep raw */
      }
      rects.push({ x0: b[0], y0: b[1], x1: b[2], y1: b[3], color: rgb });
    },
  });
  try {
    page.run(dev, mupdf.Matrix.identity);
  } finally {
    dev.close();
  }

  return { page: pageNo, width: bx1 - bx0, height: by1 - by0, lines, blocks, images, rects };
}

export function extractAll(doc: mupdf.Document): RawPage[] {
  const n = pageCount(doc);
  const out: RawPage[] = [];
  for (let p = 1; p <= n; p++) out.push(extractPage(doc, p));
  return out;
}
