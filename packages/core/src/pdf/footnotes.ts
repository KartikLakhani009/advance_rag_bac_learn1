import type { RawLine, Span } from "./extract.js";

/**
 * A span is a footnote marker when it is noticeably smaller than the line's body text, raised above
 * the baseline, made of digits (or a short digit list) and directly follows other text on the line.
 */
export function isFootnoteSpan(span: Span, body: { size: number; baseline: number }, hasPrev: boolean): boolean {
  if (!hasPrev) return false;
  if (!/^\d{1,2}(?:[,–-]\d{1,2})*$/.test(span.text.trim())) return false;
  const smaller = span.size <= body.size * 0.78;
  const raised = body.baseline - span.baseline >= Math.max(0.8, body.size * 0.12);
  return smaller && raised;
}

/** Line text with superscript footnote spans rewritten to [^n] (comma lists become [^a][^b]). */
export function lineTextWithFootnotes(line: RawLine): { text: string; notes: number[] } {
  const notes: number[] = [];
  let out = "";
  line.spans.forEach((s, i) => {
    if (isFootnoteSpan(s, line, out.trim().length > 0 && i > 0)) {
      const nums = s.text.trim().split(/[,–-]/).filter(Boolean).map(Number);
      for (const n of nums) {
        notes.push(n);
        out += `[^${n}]`;
      }
    } else out += s.text;
  });
  return { text: out.replace(/\s+$/g, ""), notes };
}

/** Parse "1 text 2 text …" endnote pages into a map n → text. Notes are 1..maxN, in increasing order. */
export function parseEndnotes(lines: string[], maxN = 99): Map<number, string> {
  const map = new Map<number, string>();
  let cur = 0;
  let buf: string[] = [];
  const flush = () => {
    if (cur > 0) map.set(cur, buf.join(" ").replace(/\s+/g, " ").trim());
    buf = [];
  };
  for (const raw of lines) {
    const t = raw.trim();
    const m = /^(\d{1,2})\s+(\S.*)$/.exec(t);
    if (m && Number(m[1]) === cur + 1 && Number(m[1]) <= maxN) {
      flush();
      cur = Number(m[1]);
      buf.push(m[2]!);
    } else if (/^\d{1,2}$/.test(t) && Number(t) === cur + 1) {
      flush();
      cur = Number(t);
    } else if (cur > 0) buf.push(t);
  }
  flush();
  return map;
}
