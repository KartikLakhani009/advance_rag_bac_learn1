import type { DocPage } from "./document.js";
import type { RawLine, RawRect, Span } from "./extract.js";
import { isFootnoteSpan } from "./footnotes.js";
import type { BBox } from "../schemas.js";

export interface TableRow {
  label: string;
  cells: string[];
  y: number;
}

export interface RebuiltTable {
  page: number;
  title: string;
  columns: string[];
  rows: TableRow[];
  bbox: BBox;
  /** the formatted chunk text */
  text: string;
}

const isDark = (c: number[]) => c.length >= 3 && c[0]! + c[1]! + c[2]! < 1.2;

/** Dark filled rectangles wider than tall that are not page-sized backgrounds. */
export function findHeaderRects(rects: RawRect[], pageW: number, pageH: number): RawRect[] {
  return rects.filter((r) => {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    return isDark(r.color) && w > 30 && h > 8 && h < 70 && w < pageW * 0.95 && h < pageH * 0.2;
  });
}

const touches = (a: RawRect, b: RawRect, tol = 2) => a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.y0 <= b.y1 + tol && b.y0 <= a.y1 + tol;

/** Union-find over touching rectangles: each connected group is one table header bar. */
function groupRects(rects: RawRect[]): RawRect[][] {
  const parent = rects.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) if (touches(rects[i]!, rects[j]!)) parent[find(i)] = find(j);
  const groups = new Map<number, RawRect[]>();
  rects.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]));
  return [...groups.values()];
}

export interface Word {
  text: string;
  x0: number;
  x1: number;
  y: number;
}

/**
 * Words from spans: adjacent spans with no visible gap are glued ("CO" + subscript "2" + "e" → "CO2e");
 * a raised, smaller digit span becomes a footnote marker "[^7]" glued to the previous word.
 */
export function lineWords(l: RawLine): Word[] {
  const out: Word[] = [];
  const bodySize = l.size;
  l.spans.forEach((s: Span, i: number) => {
    const t = s.text.replace(/\s+$/g, "");
    if (!t.trim()) return;
    const prev = out[out.length - 1];
    if (isFootnoteSpan(s, l, i > 0 && !!prev)) {
      const nums = t.trim().split(/[,–-]/).filter(Boolean);
      prev!.text += nums.map((n) => `[^${n}]`).join("");
      prev!.x1 = s.x1;
      return;
    }
    const leadingSpace = /^\s/.test(s.text);
    const gap = prev ? s.x0 - prev.x1 : 99;
    if (prev && !leadingSpace && gap < bodySize * 0.28) {
      prev.text += t;
      prev.x1 = s.x1;
    } else {
      // a span may itself contain several words separated by spaces: keep as one "word" run
      out.push({ text: t.trim(), x0: s.x0, x1: s.x1, y: s.baseline });
    }
  });
  return out;
}

/**
 * Header-bar table rebuild (spec section 18). Each table sits under a dark bar: find the filled
 * rectangles, treat touching ones as one header, read the cell texts, then rebuild rows from word
 * positions under the bar until the next bar, a "Note", a prose-length line or a big vertical gap.
 *
 * Header cells: leaf rectangles (those containing no smaller rectangle). The leftmost leaf is the row-label
 * header; the others are the value columns. A rectangle spanning several leaves is a super-header (title).
 */
export function rebuildTables(p: DocPage): RebuiltTable[] {
  const raw = p.raw;
  const groups = groupRects(findHeaderRects(raw.rects, raw.width, raw.height));
  const bars = groups
    .map((g) => ({
      rects: g,
      x0: Math.min(...g.map((r) => r.x0)),
      y0: Math.min(...g.map((r) => r.y0)),
      x1: Math.max(...g.map((r) => r.x1)),
      y1: Math.max(...g.map((r) => r.y1)),
    }))
    .sort((a, b) => a.y0 - b.y0);

  const tables: RebuiltTable[] = [];
  bars.forEach((bar, idx) => {
    const barWords = raw.lines
      .flatMap(lineWords)
      .filter((w) => w.y >= bar.y0 - 1 && w.y <= bar.y1 + 3 && w.x0 >= bar.x0 - 3 && w.x1 <= bar.x1 + 3);
    const inRect = (r: RawRect, w: Word) =>
      (w.x0 + w.x1) / 2 >= r.x0 - 1 && (w.x0 + w.x1) / 2 <= r.x1 + 1 && w.y >= r.y0 - 1 && w.y <= r.y1 + 3;
    // a super-header sits above narrower sub-header cells (stacked) or fully contains them
    const contains = (a: RawRect, b: RawRect) =>
      a !== b &&
      b.x1 - b.x0 < a.x1 - a.x0 - 3 &&
      (b.x0 + b.x1) / 2 >= a.x0 &&
      (b.x0 + b.x1) / 2 <= a.x1 &&
      (b.y0 >= a.y1 - 1.5 || (a.y0 <= b.y0 + 1 && a.y1 >= b.y1 - 1));
    const leaves = bar.rects.filter((r) => !bar.rects.some((o) => contains(r, o))).sort((a, b) => a.x0 - b.x0);
    const supers = bar.rects.filter((r) => bar.rects.some((o) => contains(r, o)));
    const cellText = (r: RawRect) =>
      barWords
        .filter((w) => inRect(r, w))
        .sort((a, b) => a.y - b.y || a.x0 - b.x0)
        .map((w) => w.text)
        .join(" ")
        .trim();

    const labelCell = leaves[0];
    const valueCells = leaves.slice(1);
    const labelHeader = labelCell ? cellText(labelCell) : "";
    const superText = supers.map(cellText).filter(Boolean).join(" ");
    const title = superText ? (labelHeader ? `${superText} (${labelHeader})` : superText) : labelHeader;
    const columns = valueCells.map(cellText);
    const firstValueX = valueCells.length ? valueCells[0]!.x0 : bar.x0 + (bar.x1 - bar.x0) * 0.5;

    const nextBarY =
      bars.slice(idx + 1).find((n) => n.y0 > bar.y1 && Math.min(n.x1, bar.x1) - Math.max(n.x0, bar.x0) > 10)?.y0 ?? raw.height;
    const body = raw.lines
      .filter((l) => l.y0 >= bar.y1 - 1 && l.y0 < nextBarY - 1 && l.x0 >= bar.x0 - 6 && l.x1 <= bar.x1 + 6)
      .sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
    const kept: RawLine[] = [];
    let lastY = bar.y1;
    for (const l of body) {
      if (l.y0 - lastY > 38) break;
      if (/^\s*Note\b/.test(l.text) || l.text.length > 80) break;
      kept.push(l);
      lastY = Math.max(lastY, l.y1);
    }

    const rows = buildRows(kept, valueCells, firstValueX);
    const bottom = kept.length ? Math.max(...kept.map((l) => l.y1)) : bar.y1;
    const bbox = { x0: bar.x0, y0: bar.y0, x1: bar.x1, y1: bottom };
    tables.push({ page: p.page, title, columns, rows, bbox, text: formatTable({ title, columns, rows }) });
  });
  return tables.filter((t) => t.rows.length > 0);
}

function buildRows(lines: RawLine[], valueCells: RawRect[], firstValueX: number): TableRow[] {
  const ws = lines.flatMap(lineWords).sort((a, b) => a.y - b.y);
  const rowsByY: Word[][] = [];
  for (const w of ws) {
    const r = rowsByY.find((row) => Math.abs(row[0]!.y - w.y) < 3.2);
    if (r) r.push(w);
    else rowsByY.push([w]);
  }
  const out: TableRow[] = [];
  for (const row of rowsByY) {
    const sorted = [...row].sort((a, b) => a.x0 - b.x0);
    const labelWords = sorted.filter((w) => (w.x0 + w.x1) / 2 < firstValueX);
    const valueWords = sorted.filter((w) => (w.x0 + w.x1) / 2 >= firstValueX);
    const label = labelWords
      .map((w) => w.text)
      .join(" ")
      .replace(/^[•·▪-]\s*/, "")
      .trim();
    const cells = valueCells.length
      ? valueCells.map((c) =>
          valueWords
            .filter((w) => (w.x0 + w.x1) / 2 >= c.x0 - 1 && (w.x0 + w.x1) / 2 <= c.x1 + 1)
            .map((w) => w.text)
            .join(" ")
            .trim(),
        )
      : [
          valueWords
            .map((w) => w.text)
            .join(" ")
            .trim(),
        ];
    if (!label && cells.every((c) => !c)) continue;
    out.push({ label, cells, y: row[0]!.y });
  }
  return mergeWrapped(out);
}

/** A label-only row directly above a value-only row (or a row wrapped onto a second line) is one row. */
function mergeWrapped(rows: TableRow[]): TableRow[] {
  const out: TableRow[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && r.y - prev.y < 10.5 && prev.cells.every((c) => !c) && r.label) {
      prev.label = `${prev.label} ${r.label}`.trim();
      prev.cells = r.cells;
      prev.y = r.y;
    } else if (prev && r.y - prev.y < 10.5 && !r.label && prev.cells.every((c) => !c)) {
      prev.cells = r.cells;
      prev.y = r.y;
    } else out.push({ ...r, cells: [...r.cells] });
  }
  return out;
}

/** One row as a self-contained line: `Table title (columns) | Row label: col: value; col: value`. */
export function formatRow(t: { title: string; columns: string[] }, r: TableRow): string {
  const cols = t.columns;
  const vals = r.cells.map((c, i) => (cols.length > 1 && cols[i] && c ? `${cols[i]}: ${c}` : c)).filter(Boolean);
  const ctx = cols.length === 1 ? ` (${cols[0]})` : "";
  return `${t.title}${ctx} | ${r.label}: ${vals.join("; ")}`.replace(/: $/, "").trim();
}

export function formatTable(t: { title: string; columns: string[]; rows: TableRow[] }): string {
  const lines: string[] = [];
  const cols = t.columns;
  lines.push(`Table: ${t.title}.${cols.length ? ` Column: ${cols.join(" | ")}` : ""}`);
  for (const r of t.rows) {
    const vals = r.cells.map((c, i) => (cols.length > 1 && cols[i] && c ? `${cols[i]}: ${c}` : c)).filter(Boolean);
    lines.push(`${r.label}: ${vals.join("; ")}`.replace(/: $/, "").trim());
  }
  return lines.join("\n");
}

/** Is a line inside any table area (± margin)? Prose chunking skips these lines. */
export function inTableArea(l: { x0: number; y0: number; x1: number; y1: number }, tables: RebuiltTable[], margin = 6): boolean {
  return tables.some(
    (t) => l.x0 >= t.bbox.x0 - margin && l.x1 <= t.bbox.x1 + margin && l.y0 >= t.bbox.y0 - margin && l.y1 <= t.bbox.y1 + margin,
  );
}
