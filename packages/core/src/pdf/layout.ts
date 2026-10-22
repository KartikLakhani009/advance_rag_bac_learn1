import type { RawLine, RawPage } from "./extract.js";

export interface Line extends RawLine {
  page: number;
  /** 0 = left column / single, 1 = right column, "wide" = spans the page */
  column: 0 | 1 | "wide";
}

/** Layout thresholds, tuned to the three PDFs (see the "Assumptions" section of each understanding doc). */
const LAYOUT = {
  /** header/footer band: top/bottom share of the page height */
  bandShare: 0.09,
  /** furniture = same text at the same position on at least this share of pages (min 3 pages) */
  furnitureShare: 0.1,
  /** a block at least this share of the page width is "wide" (title, banner, full-width figure) */
  wideShare: 0.55,
  /** … or any block that crosses the page centre by this share of the width on both sides */
  centreCrossShare: 0.12,
  /** line y-gap (in font sizes) that starts a new paragraph */
  paragraphGap: 0.6,
  /** first-line indent (points) that starts a new paragraph */
  indent: 8,
} as const;

const norm = (t: string) => t.replace(/\s+/g, "").replace(/\d+/g, "#").toLowerCase();

/**
 * Header/footer signatures: text that repeats at (nearly) the same position on many pages.
 * Only the top/bottom page bands are considered, so body text can never be dropped.
 */
export function findRepeatedFurniture(pages: RawPage[], minShare: number = LAYOUT.furnitureShare): Set<string> {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const l of p.lines) {
      if (!inBand(p, l)) continue;
      const key = signature(l);
      if (!seen.has(key)) {
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const min = Math.max(3, Math.floor(pages.length * minShare));
  return new Set([...counts.entries()].filter(([, c]) => c >= min).map(([k]) => k));
}

function inBand(p: RawPage, l: RawLine): boolean {
  return l.y1 <= p.height * LAYOUT.bandShare || l.y0 >= p.height * (1 - LAYOUT.bandShare);
}

function signature(l: RawLine): string {
  return `${norm(l.text)}@${Math.round(l.y0 / 6)}`;
}

/** Page number-ish lines in the band are dropped too (they are read by pages.ts). */
function isPageNumber(l: RawLine): boolean {
  const t = l.text.trim();
  return /^\d{1,3}$/.test(t) || /^[ivxlc]{1,6}$/i.test(t);
}

export function removeFurniture(p: RawPage, furniture: Set<string>): RawLine[] {
  return p.lines.filter((l) => {
    if (!inBand(p, l)) return true;
    if (furniture.has(signature(l))) return false;
    if (isPageNumber(l)) return false;
    return true;
  });
}

/**
 * Band-based two-column reading order.
 * Wide blocks (titles, banners, full-width figures) split the page into bands; inside a band the
 * left column is read top to bottom, then the right column.
 */
export function readingOrder(p: RawPage, lines: RawLine[]): Line[] {
  const W = p.width;
  const mid = W / 2;
  const blockBox = new Map<number, { x0: number; x1: number; y0: number; y1: number }>();
  for (const l of lines) {
    const b = blockBox.get(l.blockId);
    if (!b) blockBox.set(l.blockId, { x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1 });
    else {
      b.x0 = Math.min(b.x0, l.x0);
      b.x1 = Math.max(b.x1, l.x1);
      b.y0 = Math.min(b.y0, l.y0);
      b.y1 = Math.max(b.y1, l.y1);
    }
  }
  const wideLimit = W * LAYOUT.wideShare;
  const isWide = (id: number) => {
    const b = blockBox.get(id)!;
    return b.x1 - b.x0 >= wideLimit || (b.x0 < mid - W * LAYOUT.centreCrossShare && b.x1 > mid + W * LAYOUT.centreCrossShare);
  };

  const wideBlocks = [...blockBox.entries()]
    .filter(([id]) => isWide(id))
    .map(([id, b]) => ({ id, cy: (b.y0 + b.y1) / 2, y0: b.y0 }))
    .sort((a, b) => a.y0 - b.y0);

  const bandOf = (cy: number) => wideBlocks.filter((w) => w.cy < cy).length;

  const items: Array<{ line: RawLine; band: number; col: number; wideIdx: number }> = [];
  for (const l of lines) {
    if (isWide(l.blockId)) {
      const idx = wideBlocks.findIndex((w) => w.id === l.blockId);
      items.push({ line: l, band: idx, col: 2, wideIdx: idx });
    } else {
      const b = blockBox.get(l.blockId)!;
      const cx = (b.x0 + b.x1) / 2;
      const lcx = (l.x0 + l.x1) / 2;
      const col = (cx < mid ? 0 : 1) === (lcx < mid ? 0 : 1) ? (cx < mid ? 0 : 1) : lcx < mid ? 0 : 1;
      items.push({ line: l, band: bandOf((l.y0 + l.y1) / 2), col, wideIdx: -1 });
    }
  }
  // order: band n narrow (left, right), then wide block n (it closes band n), ...
  const rank = (it: (typeof items)[number]) => (it.col === 2 ? it.wideIdx * 10 + 5 : it.band * 10 + it.col * 2);
  items.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (Math.abs(a.line.baseline - b.line.baseline) > 2) return a.line.baseline - b.line.baseline;
    return a.line.x0 - b.line.x0;
  });
  // wide blocks: lines with the same baseline across x are one row; sorted above by baseline then x.
  return items.map((it) => ({ ...it.line, page: p.page, column: it.col === 2 ? "wide" : (it.col as 0 | 1) }));
}

/** Group reading-ordered lines into paragraphs (blank-line gaps, indents, style changes). */
export function toParagraphs(lines: Line[]): Line[][] {
  // left margin of each column on each page: an indented first line is measured against it
  const colLeft = new Map<string, number>();
  const colKey = (l: Line) => `${l.page}:${l.column}`;
  for (const l of lines) colLeft.set(colKey(l), Math.min(colLeft.get(colKey(l)) ?? Infinity, l.x0));
  const indent = (l: Line) => l.x0 - (colLeft.get(colKey(l)) ?? l.x0);

  const startsParagraph = (prev: Line, l: Line): boolean =>
    prev.page !== l.page ||
    prev.column !== l.column ||
    prev.blockId !== l.blockId ||
    Math.abs(l.size - prev.size) > 0.5 ||
    l.bold !== prev.bold ||
    l.y0 - prev.y1 > l.size * LAYOUT.paragraphGap ||
    // an indented line after a finished sentence
    (indent(l) > LAYOUT.indent && indent(prev) <= LAYOUT.indent && /[.!?:”"]$/.test(prev.text.trim()));

  const paragraphs: Line[][] = [];
  for (const l of lines) {
    const current = paragraphs[paragraphs.length - 1];
    const prev = current?.[current.length - 1];
    if (current && prev && !startsParagraph(prev, l)) current.push(l);
    else paragraphs.push([l]);
  }
  return paragraphs;
}

/**
 * Drop caps: a lone, much larger letter ("T" at 60pt) sits in its own block, and its baseline is lower than the
 * paragraph's first line, so reading order puts it in the wrong place ("he U.S. Government…" … "Tprocuring").
 * Glue it onto the first line of the paragraph it belongs to: the topmost lower-case-starting line to its right
 * within the cap's vertical extent.
 */
export function mergeDropCaps(lines: Line[]): Line[] {
  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] ?? 10;
  const caps = lines.filter((l) => /^[A-Za-z]$/.test(l.text.trim()) && l.size >= body * 3);
  if (caps.length === 0) return lines;
  const drop = new Set<Line>();
  const patched = new Map<Line, Line>();
  for (const cap of caps) {
    const target = lines
      .filter(
        (l) =>
          l !== cap &&
          !patched.has(l) &&
          /^[a-z]/.test(l.text) &&
          l.x0 >= cap.x0 + (cap.x1 - cap.x0) * 0.4 &&
          l.y0 >= cap.y0 - 3 &&
          l.y0 <= cap.y1,
      )
      .sort((a, b) => a.y0 - b.y0)[0];
    if (!target) continue;
    const letter = cap.text.trim();
    const first = target.spans[0]!;
    patched.set(target, {
      ...target,
      text: letter + target.text,
      spans: [{ ...first, text: letter + first.text }, ...target.spans.slice(1)],
    });
    drop.add(cap);
  }
  return lines.filter((l) => !drop.has(l)).map((l) => patched.get(l) ?? l);
}
