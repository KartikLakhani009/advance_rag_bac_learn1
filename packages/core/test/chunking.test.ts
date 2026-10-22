import { describe, expect, it } from "vitest";
import { attachEndnotes } from "../src/chunking/elements.js";
import { buildHierarchy } from "../src/chunking/hierarchy.js";
import { naiveChunks } from "../src/chunking/naive.js";
import { sentenceChunks, toSentenceUnits, windowSentences } from "../src/chunking/sentence.js";
import { endsOnSentenceBoundary, splitSentences } from "../src/text/sentences.js";
import { countTokens } from "../src/text/tokens.js";

const sentence = (i: number) => `This is sentence number ${i} about the annual report and its numbers.`;
const text = Array.from({ length: 60 }, (_, i) => sentence(i)).join(" ");

describe("sentence splitting", () => {
  it("does not split on abbreviations", () => {
    expect(splitSentences("GPO produced 16 million U.S. passports. See Fig. 3 for details, e.g. the totals. No. 5 was best.")).toEqual([
      "GPO produced 16 million U.S. passports.",
      "See Fig. 3 for details, e.g. the totals.",
      "No. 5 was best.",
    ]);
  });
  it("keeps a footnote marker with its sentence", () => {
    const s = splitSentences("iMac uses 58 percent less energy than the requirement for ENERGY STAR.[^18] We design products to last.");
    expect(s).toHaveLength(2);
    expect(s[0]).toContain("[^18]");
  });
  it("detects sentence-final text", () => {
    expect(endsOnSentenceBoundary("It ended here.")).toBe(true);
    expect(endsOnSentenceBoundary("It ended mid-wor")).toBe(false);
    expect(endsOnSentenceBoundary("Made in the U.S.")).toBe(false);
  });
});

describe("sentence chunks", () => {
  const units = toSentenceUnits(text, 1, "1");
  const chunks = sentenceChunks(units, { targetTokens: 120, overlapTokens: 30, idPrefix: "t", kind: "sentence" });

  it("cuts only on sentence boundaries", () => {
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.endsOnSentence).toBe(true);
    for (const c of chunks) expect(c.text.startsWith("This is sentence")).toBe(true);
  });
  it("respects the token target (whole sentences only)", () => {
    for (const c of chunks) expect(countTokens(c.text)).toBeLessThanOrEqual(120 + 20);
  });
  it("carries a sentence-aligned overlap from the end of the previous chunk", () => {
    for (let i = 1; i < chunks.length; i++) {
      const prevSentences = splitSentences(chunks[i - 1]!.text);
      const first = splitSentences(chunks[i]!.text)[0]!;
      expect(prevSentences).toContain(first);
    }
  });
  it("makes progress even when a single sentence exceeds the target", () => {
    const big = toSentenceUnits(`${"word ".repeat(300).trim()}. Short one.`, 1, "1");
    const w = windowSentences(big, { targetTokens: 50, overlapTokens: 20 });
    expect(w[0]![1]).toBe(1);
    expect(w.length).toBe(2);
  });
});

describe("naive chunks", () => {
  it("cuts fixed 1000-char windows, mostly mid-sentence", () => {
    const c = naiveChunks([{ page: 1, printedPage: "1", text }], 1000);
    expect(c.length).toBeGreaterThan(2);
    expect(c.filter((x) => x.endsOnSentence).length).toBeLessThan(c.length);
  });
  it("tracks page ranges by offset", () => {
    const c = naiveChunks(
      [
        { page: 5, printedPage: "3", text: "a ".repeat(400) },
        { page: 6, printedPage: "4", text: "b ".repeat(400) },
      ],
      1000,
    );
    expect(c[0]!.page).toBe(5);
    expect(c.some((x) => x.page === 5 && x.pageEnd === 6)).toBe(true);
    expect(c[c.length - 1]!.printedPageEnd).toBe("4");
  });
});

describe("hierarchy", () => {
  it("builds parents of ~900 tokens and children of ~280 inside one section, children linked to parents", () => {
    const units = toSentenceUnits(text.repeat(2), 1, "1");
    const { parents, children } = buildHierarchy(
      [
        {
          id: "s0",
          meta: { kind: "body", headingPath: "Chapter 2: Regional Outlooks > South Asia > Outlook", region: "South Asia", chapter: 2 },
          units,
        },
      ],
      {
        parentTokens: 900,
        childTokens: 280,
        childOverlap: 40,
      },
    );
    expect(parents.length).toBeGreaterThan(1);
    for (const p of parents) expect(p.tokens!).toBeLessThanOrEqual(900 + 30);
    for (const c of children) {
      expect(c.tokens!).toBeLessThanOrEqual(280 + 30);
      expect(parents.find((p) => p.id === c.parentId)).toBeTruthy();
      expect(c.region).toBe("South Asia");
      expect(c.headingPath).toContain("South Asia");
    }
    for (const p of parents) expect(p.childIds.length).toBeGreaterThan(0);
  });
});

describe("endnote linking", () => {
  const notes = new Map([[18, "Energy consumption values are based on the ENERGY STAR Program Requirements."]]);
  it("removes markers and appends [Note n]", () => {
    const r = attachEndnotes(
      "iMac uses 58 percent less energy than the requirement for ENERGY STAR.[^18] We design products to last.",
      notes,
    );
    expect(r.noteNumbers).toEqual([18]);
    expect(r.text).not.toContain("[^18]");
    expect(r.text).toContain("[Note 18] Energy consumption values");
    expect(r.text).toContain("ENERGY STAR. We design");
  });
  it("caps note text at 700 chars", () => {
    const r = attachEndnotes("x[^1]", new Map([[1, "y".repeat(2000)]]));
    expect(r.text.split("\n")[1]!.length).toBe("[Note 1] ".length + 700);
  });
});
