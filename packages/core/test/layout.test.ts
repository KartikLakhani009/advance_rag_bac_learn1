import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { RAW_DIR } from "../src/config.js";
import { loadDocument, type LoadedDoc } from "../src/pdf/document.js";

let gpo: LoadedDoc;
let gep: LoadedDoc;
beforeAll(() => {
  gpo = loadDocument("gpo", path.join(RAW_DIR, "GPO-Anual-report.pdf"));
  gep = loadDocument("gep", path.join(RAW_DIR, "GEP-Jun-2026.pdf"));
});

function assertColumnsNotInterleaved(cols: Array<0 | 1 | "wide">) {
  const lastLeft = cols.lastIndexOf(0);
  const firstRight = cols.indexOf(1);
  expect(lastLeft).toBeGreaterThanOrEqual(0);
  expect(firstRight).toBeGreaterThan(lastLeft);
}

describe("reading order on two-column pages", () => {
  it("GPO PDF page 6: left column is read completely before the right column", () => {
    const p = gpo.pages[5]!;
    assertColumnsNotInterleaved(p.lines.map((l) => l.column));
    const text = p.lines.map((l) => l.clean).join(" ");
    expect(text.indexOf("operational efficiencies")).toBeGreaterThan(-1);
    expect(text.indexOf("operational efficiencies")).toBeLessThan(text.indexOf("For the 22nd year in a row"));
    // the first column's last paragraph ends before the second column starts
    expect(text.indexOf("Compensation Act (FECA)")).toBeLessThan(text.indexOf("For the 22nd year in a row"));
  });

  it("GEP chapter page (PDF 96, South Asia): Recent developments then Outlook, no interleaving", () => {
    const p = gep.pages[95]!;
    assertColumnsNotInterleaved(p.lines.map((l) => l.column));
    const text = p.lines.map((l) => l.clean).join(" ");
    expect(text.indexOf("Recent developments")).toBeLessThan(text.indexOf("Outlook"));
    expect(text.indexOf("measures to support financial stability")).toBeLessThan(
      text.indexOf("Growth in SAR is expected to soften to 6.3"),
    );
  });

  it("removes running headers/footers but keeps body text", () => {
    const gpoText = gpo.pages[5]!.lines.map((l) => l.clean).join(" ");
    expect(gpoText).not.toMatch(/A N N U A L R E P O R T/);
    const gepText = gep.pages[95]!.lines.map((l) => l.clean).join(" ");
    expect(gepText).not.toMatch(/GLOBAL ECONOMIC PROSPECTS \| JUNE 2026/);
  });

  it("detects printed page numbers", () => {
    expect(gep.pages[95]!.printedPage).toBe("74");
    expect(gep.pages[18]!.printedPage).toBe("xvii");
    expect(gpo.pages[13]!.printedPage).toBe("12");
    expect(gpo.pages[41]!.printedPage).toBe("11");
  });
});
