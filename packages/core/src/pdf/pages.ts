import type { RawPage } from "./extract.js";

export type DocKey = "gpo" | "gep" | "imac";

const ROMAN = /^[ivxlc]{1,6}$/i;

/**
 * Printed page number from the header/footer band of one page.
 * Returns the string as printed ("74", "xvii") or undefined when the page has none.
 */
export function detectPrintedPage(p: RawPage): string | undefined {
  const bandTop = p.height * 0.09;
  const bandBottom = p.height * 0.91;
  const margin = p.width * 0.12;
  const inBand = p.lines.filter((l) => (l.y1 <= bandTop || l.y0 >= bandBottom) && l.size <= 10);
  // page numbers sit in a corner; centred strays ("2" under a signature) are not page numbers
  const cands = inBand.filter((l) => l.x0 <= margin || l.x1 >= p.width - margin);
  for (const l of cands) {
    const t = l.text.trim();
    if (/^\d{1,3}$/.test(t)) return t;
    if (ROMAN.test(t)) return t.toLowerCase();
  }
  return undefined;
}

export function romanToInt(s: string): number {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let n = 0;
  const t = s.toLowerCase();
  for (let i = 0; i < t.length; i++) {
    const a = v[t[i]!] ?? 0;
    const b = v[t[i + 1] ?? ""] ?? 0;
    n += a < b ? -a : a;
  }
  return n;
}

export function intToRoman(n: number): string {
  const map: Array<[number, string]> = [
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  for (const [v, s] of map)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}

/** First PDF page of GEP Chapter 1 (printed page 1). */
export const GEP_CH1_PDF = 23;
/** First PDF page of the GPO financial section (numbering restarts). */
export const GPO_FIN_START_PDF = 33;

/**
 * Deterministic PDF → printed mapping, used as fallback where no number is printed
 * and as the reference the tests pin down (spec section 5).
 */
export function printedFromPdf(doc: DocKey, pdfPage: number): string {
  switch (doc) {
    case "imac":
      return String(pdfPage);
    case "gep":
      return pdfPage >= GEP_CH1_PDF ? String(pdfPage - 22) : intToRoman(Math.max(1, pdfPage - 2));
    case "gpo":
      return String(pdfPage >= GPO_FIN_START_PDF ? pdfPage - 31 : pdfPage - 2);
  }
}

export function pdfFromPrinted(doc: DocKey, printed: string, section: "annual" | "financial" = "annual"): number {
  switch (doc) {
    case "imac":
      return Number(printed);
    case "gep":
      return ROMAN.test(printed) ? romanToInt(printed) + 2 : Number(printed) + 22;
    case "gpo":
      return Number(printed) + (section === "financial" ? 31 : 2);
  }
}
