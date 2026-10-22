import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { RAW_DIR } from "../src/config.js";
import { loadDocument, type LoadedDoc } from "../src/pdf/document.js";
import { rebuildTables } from "../src/pdf/tables.js";

let imac: LoadedDoc;
beforeAll(() => {
  imac = loadDocument("imac", path.join(RAW_DIR, "iMac_PER_Oct2024.pdf"));
});

describe("header-bar table rebuild (iMac page 10)", () => {
  it("rebuilds the greenhouse gas table as one table, not fragments", () => {
    const tables = rebuildTables(imac.pages[9]!);
    expect(tables).toHaveLength(2);
    const ghg = tables[0]!;
    expect(ghg.title).toBe("Greenhouse gas emissions");
    expect(ghg.columns).toEqual(["iMac (two ports) 256GB"]);
    expect(ghg.rows.length).toBe(8);
    const lines = ghg.text.split("\n");
    expect(lines[0]).toBe("Table: Greenhouse gas emissions. Column: iMac (two ports) 256GB");
    expect(lines).toContain("Total product footprint: 346 kg CO2e");
    expect(lines).toContain("Production: 50%");
    expect(lines).toContain("Product use: 45%");
    expect(lines).toContain("GHG reductions achieved[^7]: ↓>20%");
  });

  it("rebuilds the configuration table", () => {
    const cfg = rebuildTables(imac.pages[9]!)[1]!;
    expect(cfg.title).toBe("Configuration");
    expect(cfg.text).toContain("391 kg CO2e");
  });

  it("rebuilds the power consumption table on page 12 with its super-header", () => {
    const [t] = rebuildTables(imac.pages[11]!);
    expect(t!.columns).toEqual(["100V", "115V", "230V"]);
    expect(t!.text).toContain("Sleep: 100V: 0.56W; 115V: 0.57W; 230V: 0.59W");
    expect(t!.text).not.toContain("trade-in");
  });

  it("finds no tables on prose pages", () => {
    for (const n of [3, 4, 5, 6, 7, 8, 9]) expect(rebuildTables(imac.pages[n - 1]!)).toHaveLength(0);
  });
});
