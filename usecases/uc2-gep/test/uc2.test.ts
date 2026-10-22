import { beforeAll, describe, expect, it } from "vitest";
import { buildHier, loadUc2, tableMeta, type Uc2Doc } from "../src/chunks.js";
import { routeByRules, toFilter } from "../src/regions.js";
import { classify } from "../src/structure.js";

let u: Uc2Doc;
beforeAll(() => {
  u = loadUc2();
});

describe("font classification (thresholds tuned to GEP)", () => {
  const h = "HelveticaLTStd-Roman";
  it("caption / section / subsection / small / body", () => {
    expect(classify({ text: "BOX 1.1 How much will AI affect global growth?", font: "HelveticaLTStd-Bold", size: 10, bold: true })).toBe(
      "caption",
    );
    expect(classify({ text: "South Asia", font: "HelveticaLTStd-Bold", size: 16, bold: true })).toBe("section");
    expect(classify({ text: "Outlook", font: h, size: 11, bold: false })).toBe("subsection");
    expect(classify({ text: "Chart label", font: h, size: 6, bold: false })).toBe("small");
    expect(
      classify({ text: "Growth in SAR is expected to soften to 6.3 percent.", font: "AGaramondPro-Regular", size: 11, bold: false }),
    ).toBe("body");
    expect(classify({ text: "Helvetica but a long sentence that ends with a period.", font: h, size: 11, bold: false })).toBe("body");
  });
});

describe("rules routing", () => {
  it("maps countries and acronyms to regions; global questions get none", () => {
    expect(routeByRules("What is India's projected growth for fiscal year 2026/27?").region).toBe("South Asia");
    expect(routeByRules("What does the report say about Brazil?").region).toBe("Latin America and the Caribbean");
    expect(routeByRules("What growth is projected in 2026 for the region that includes Pakistan?").region).toBe(
      "Middle East, North Africa, Afghanistan, and Pakistan",
    );
    expect(routeByRules("What is the outlook for SSA?").region).toBe("Sub-Saharan Africa");
    expect(routeByRules("Compare South Asia and Sub-Saharan Africa").region).toBeNull();
    expect(routeByRules("What is global growth in 2026?").region).toBeNull();
  });
  it("chapter only when literally stated; executive summary; box", () => {
    expect(routeByRules("What does Chapter 3 say about sovereign debt?").chapter).toBe(3);
    expect(routeByRules("What does the report say about fiscal policy?").chapter).toBeNull();
    expect(routeByRules("According to the executive summary, what are the risks?").executive_summary).toBe(true);
    expect(routeByRules("What does Box 1.2 say?").box).toBe(true);
  });
  it("builds a filter that always excludes noise kinds", () => {
    const f = toFilter({ region: "South Asia", chapter: null, executive_summary: false, box: false });
    expect(f).toEqual({ excludeKinds: ["table_fragment", "front_matter", "references"], region: "South Asia" });
  });
});

describe("structure from fonts", () => {
  it("tags South Asia Outlook with chapter, region and heading path", () => {
    const { children, parents } = buildHier(u);
    const c = children.find((x) => /Growth in SAR is expected to soften to 6\.3 percent/.test(x.text))!;
    expect(c.headingPath).toBe("Chapter 2: Regional Outlooks > South Asia > Outlook");
    expect(c.region).toBe("South Asia");
    expect(c.chapter).toBe(2);
    expect(c.page).toBe(96);
    expect(c.printedPage).toBe("74");
    expect(parents.find((p) => p.id === c.parentId)).toBeTruthy();
  });
  it("repairs the dropped Th ligature in the executive summary", () => {
    const { children } = buildHier(u);
    const ex = children.filter((x) => x.kind === "executive_summary");
    expect(ex.length).toBeGreaterThan(0);
    expect(ex[0]!.text).toMatch(/^The global economy is facing another major shock\. The conflict in the Middle East/);
    expect(ex.every((x) => x.headingPath === "Executive Summary")).toBe(true);
  });
  it("keeps references and front matter out of the searchable sections", () => {
    const { children } = buildHier(u);
    expect(children.some((c) => ["references", "front_matter", "table_fragment"].includes(c.kind))).toBe(false);
  });
  it("table pages inherit region/chapter and get a Table heading path", () => {
    const m = tableMeta(u, 98);
    expect(m.region).toBe("South Asia");
    expect(m.headingPath).toBe("Chapter 2: Regional Outlooks > South Asia > Table 2.9, Table 2.10");
    expect(tableMeta(u, 26).headingPath).toBe("Chapter 1: Global Outlook > Table 1.1");
  });
  it("boxes are detected by their 10.6pt body and end when 11pt text returns", () => {
    const { children } = buildHier(u);
    const box = children.filter((c) => c.kind === "box");
    expect(box.length).toBeGreaterThan(10);
    expect(box.some((c) => c.headingPath?.startsWith("Chapter 1: Global Outlook > Box 1.1"))).toBe(true);
  });
});
