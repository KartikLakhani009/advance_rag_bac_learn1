import { beforeAll, describe, expect, it } from "vitest";
import { buildNaive, buildSentence, loadUc1, type Uc1Doc } from "../src/chunks.js";

let u: Uc1Doc;
beforeAll(() => {
  u = loadUc1();
});

describe("UC1 chunking", () => {
  it("sentence chunks end on a sentence boundary far more often than naive chunks", () => {
    const naive = buildNaive(u);
    const sent = buildSentence(u);
    const share = (c: { endsOnSentence?: boolean }[]) => c.filter((x) => x.endsOnSentence).length / c.length;
    expect(share(naive)).toBeLessThan(0.1);
    expect(share(sent)).toBeGreaterThan(0.5);
  });
  it("tracks PDF and printed pages (PDF = printed + 2 in the annual report part)", () => {
    const c = buildSentence(u).find((x) => x.text.includes("802,834 copies of 4,211 titles"))!;
    expect(c.page).toBe(5);
    expect(c.printedPage).toBe("3");
  });
  it("glues drop caps back onto their paragraph", () => {
    const c = buildSentence(u).find((x) => x.text.includes("U.S. Government Publishing Office (GPO), a legislative branch agency"))!;
    expect(c.text).toContain("The U.S. Government Publishing Office (GPO)");
  });
});
