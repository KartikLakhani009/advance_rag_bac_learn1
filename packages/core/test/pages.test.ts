import { describe, expect, it } from "vitest";
import { intToRoman, pdfFromPrinted, printedFromPdf, romanToInt } from "../src/pdf/pages.js";

describe("PDF ↔ printed page mapping (spec section 5)", () => {
  it("GEP: front matter is roman, Chapter 1 onward is PDF − 22", () => {
    expect(printedFromPdf("gep", 19)).toBe("xvii");
    expect(printedFromPdf("gep", 20)).toBe("xviii");
    expect(printedFromPdf("gep", 26)).toBe("4");
    expect(printedFromPdf("gep", 96)).toBe("74");
    expect(printedFromPdf("gep", 187)).toBe("165");
    expect(pdfFromPrinted("gep", "74")).toBe(96);
    expect(pdfFromPrinted("gep", "xvii")).toBe(19);
  });
  it("GPO: annual report PDF = printed + 2, financial section PDF = printed + 31", () => {
    expect(printedFromPdf("gpo", 14)).toBe("12");
    expect(printedFromPdf("gpo", 26)).toBe("24");
    expect(printedFromPdf("gpo", 42)).toBe("11");
    expect(printedFromPdf("gpo", 58)).toBe("27");
    expect(pdfFromPrinted("gpo", "12")).toBe(14);
    expect(pdfFromPrinted("gpo", "11", "financial")).toBe(42);
    expect(pdfFromPrinted("gpo", "27", "financial")).toBe(58);
  });
  it("iMac: PDF page = printed page", () => {
    expect(printedFromPdf("imac", 10)).toBe("10");
    expect(pdfFromPrinted("imac", "12")).toBe(12);
  });
  it("roman numerals round-trip", () => {
    for (const n of [1, 4, 9, 17, 18, 22]) expect(romanToInt(intToRoman(n))).toBe(n);
  });
});
