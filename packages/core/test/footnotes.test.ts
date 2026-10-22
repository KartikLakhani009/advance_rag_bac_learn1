import { describe, expect, it } from "vitest";
import type { RawLine, Span } from "../src/pdf/extract.js";
import { isFootnoteSpan, lineTextWithFootnotes, parseEndnotes } from "../src/pdf/footnotes.js";

const span = (text: string, size: number, baseline: number, x0 = 0): Span => ({
  text,
  font: "F",
  size,
  bold: false,
  italic: false,
  x0,
  x1: x0 + text.length * 3,
  y0: 0,
  y1: 0,
  baseline,
});
const line = (spans: Span[]): RawLine => ({
  spans,
  text: spans.map((s) => s.text).join(""),
  x0: 0,
  y0: 0,
  x1: 100,
  y1: 10,
  baseline: spans[0]!.baseline,
  font: "F",
  size: spans[0]!.size,
  bold: false,
  blockId: 0,
});

describe("footnote markers", () => {
  it("a smaller, raised digit span right after a word becomes [^n]", () => {
    const l = line([span("GHG reductions achieved", 6.5, 284.1), span("7", 4.3, 282.5, 80)]);
    expect(lineTextWithFootnotes(l)).toEqual({ text: "GHG reductions achieved[^7]", notes: [7] });
  });
  it("a subscript (lower than the baseline) is not a footnote", () => {
    expect(isFootnoteSpan(span("2", 4.3, 286), { size: 6.5, baseline: 284.1 }, true)).toBe(false);
  });
  it("same-size digits and leading digits are not footnotes", () => {
    expect(isFootnoteSpan(span("7", 6.5, 284.1), { size: 6.5, baseline: 284.1 }, true)).toBe(false);
    expect(isFootnoteSpan(span("7", 4.3, 282.5), { size: 6.5, baseline: 284.1 }, false)).toBe(false);
  });
  it("parses endnotes in order and keeps wrapped lines together", () => {
    const m = parseEndnotes(["1 first note", "continues here", "2 second note", "1) not a new note", "3 third"]);
    expect([...m.keys()]).toEqual([1, 2, 3]);
    expect(m.get(1)).toBe("first note continues here");
    expect(m.get(2)).toBe("second note 1) not a new note");
  });
});
