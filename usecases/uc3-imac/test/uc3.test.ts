import { beforeAll, describe, expect, it } from "vitest";
import { notesAboutTitle } from "@rag/core/src/chunking/elements.js";
import { buildElementChunkSet, buildElementChunks, loadUc3, visionNotesToMarkers, type Uc3Doc } from "../src/chunks.js";

let u: Uc3Doc;
beforeAll(() => {
  u = loadUc3();
});

describe("iMac endnotes", () => {
  it("parses endnotes 1–19 from pages 11–12 without table or footer text", () => {
    expect([...u.endnotes.keys()]).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(u.endnotes.get(18)).toMatch(
      /^Energy consumption and energy efficiency values are based on the ENERGY STAR Program Requirements/,
    );
    expect(u.endnotes.get(18)).not.toMatch(/0\.27W|All rights reserved/);
    expect(u.endnotes.get(19)).toMatch(/^Trade-in values vary/);
  });

  it('page 7 "58 percent less energy … ENERGY STAR.18" carries Note 18', () => {
    const c = buildElementChunks(u).find((x) => x.page === 7 && /58 percent less energy/.test(x.text))!;
    expect(c).toBeTruthy();
    expect(c.text).toContain("[Note 18] Energy consumption and energy efficiency values");
    expect(c.text).not.toMatch(/\[\^\d+\]/);
    expect(c.text).toContain("ENERGY STAR. We design");
  });

  it("table chunks carry their endnotes too (GHG reductions → Note 7)", () => {
    const t = buildElementChunks(u).find((x) => x.kind === "table" && x.page === 10 && /Greenhouse/.test(x.text))!;
    expect(t.text).toContain("GHG reductions achieved: ↓>20%");
    expect(t.text).toContain("[Note 7]");
  });
});

describe("iMac element chunks", () => {
  const chunks = () => buildElementChunks(u);
  it("makes one table chunk per table and keeps table text out of prose", () => {
    const tables = chunks().filter((c) => c.kind === "table");
    expect(tables.map((t) => t.page)).toEqual([10, 10, 12]);
    const prose = chunks()
      .filter((c) => c.kind === "text" && c.page === 10)
      .map((c) => c.text)
      .join(" ");
    expect(prose).not.toMatch(/Total product footprint/);
    expect(prose).toMatch(/inherent uncertainty/);
  });
  it("does not chunk the endnote pages as prose", () => {
    expect(chunks().filter((c) => c.kind === "text" && (c.page === 11 || c.page === 12))).toHaveLength(0);
  });
  it("prose groups stay near 220 tokens", () => {
    for (const c of chunks().filter((x) => x.kind === "text")) expect(c.tokens!).toBeLessThan(220 + 700 * 3);
  });
});

describe("iMac storage design (table notes, rows, headings)", () => {
  it("the GHG table carries Note 10 (512GB) although no marker on the page points at it", () => {
    const t = buildElementChunks(u).find((x) => x.kind === "table" && x.page === 10 && /Greenhouse/.test(x.text))!;
    expect(t.text).toContain("iMac (two ports) 256GB");
    expect(t.text).toContain("[Note 10]");
    expect(t.text).toContain("512GB storage configuration");
  });
  it("matches a note to a table only when the note starts with the (multi-word) title", () => {
    expect(notesAboutTitle("Greenhouse gas emissions", u.endnotes)).toEqual([10]);
    expect(notesAboutTitle("Configuration", u.endnotes)).toEqual([]);
    expect(notesAboutTitle("Power consumption for iMac (Mode)", u.endnotes)).toEqual([]);
  });
  it("every table row is its own chunk pointing at its table, with title and column in the text", () => {
    const { chunks, rows } = buildElementChunkSet(u);
    const tableIds = new Set(chunks.filter((c) => c.kind === "table").map((c) => c.id));
    expect(rows.length).toBe(8 + 1 + 5);
    for (const r of rows) expect(tableIds.has(r.parentId!)).toBe(true);
    const sleep = rows.find((r) => /^Power consumption for iMac \(Mode\) \| Sleep:/.test(r.text))!;
    expect(sleep.text).toContain("115V: 0.57W");
    const foot = rows.find((r) => /Total product footprint/.test(r.text))!;
    expect(foot.text).toBe("Greenhouse gas emissions (iMac (two ports) 256GB) | Total product footprint: 346 kg CO2e");
  });
  it("heading paths start with the page title", () => {
    const { chunks } = buildElementChunkSet(u);
    expect(chunks.find((c) => c.kind === "table" && c.page === 10)!.headingPath).toBe("Carbon Footprint > Greenhouse gas emissions");
    // the table on the "Endnotes" page is not filed under "Endnotes"
    expect(chunks.find((c) => c.kind === "table" && c.page === 12)!.headingPath).toBe("Power consumption for iMac (Mode)");
    expect(chunks.find((c) => c.kind === "text" && c.page === 7)!.headingPath).toMatch(/^Use/);
  });
  it("vision footnotes [note n] become linkable markers", () => {
    expect(visionNotesToMarkers("GHG reductions [note 7] and [Note 10]")).toBe("GHG reductions [^7] and [^10]");
  });
});
