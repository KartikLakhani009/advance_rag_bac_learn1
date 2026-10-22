import { describe, expect, it } from "vitest";
import { buildBm25, bm25Search, embeddedText } from "../src/retrieve/bm25.js";
import { matchesFilter, toChromaWhere } from "../src/retrieve/filters.js";
import { rrfFuse } from "../src/retrieve/hybrid.js";
import { swapChildrenForParents } from "../src/retrieve/parents.js";
import type { Chunk } from "../src/schemas.js";

const chunk = (id: string, text: string, extra: Partial<Chunk> = {}): Chunk => ({
  id,
  kind: "body",
  text,
  page: 1,
  pageEnd: 1,
  printedPage: "1",
  printedPageEnd: "1",
  assetIds: [],
  ...extra,
});

describe("RRF", () => {
  it("scores 1/(k+rank) with rank from 0 and sums across lists", () => {
    const fused = rrfFuse(
      [
        [
          { id: "a", score: 9 },
          { id: "b", score: 8 },
        ],
        [
          { id: "b", score: 5 },
          { id: "c", score: 4 },
        ],
      ],
      2,
    );
    const s = Object.fromEntries(fused.map((r) => [r.id, r.score]));
    expect(s.a).toBeCloseTo(1 / 2);
    expect(s.b).toBeCloseTo(1 / 3 + 1 / 2);
    expect(s.c).toBeCloseTo(1 / 3);
    expect(fused.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
  it("uses ranks only: raw scores do not matter", () => {
    const a = rrfFuse(
      [
        [
          { id: "x", score: 1000 },
          { id: "y", score: 1 },
        ],
      ],
      60,
    );
    const b = rrfFuse(
      [
        [
          { id: "x", score: 0.2 },
          { id: "y", score: 0.1 },
        ],
      ],
      60,
    );
    expect(a.map((r) => r.score)).toEqual(b.map((r) => r.score));
  });
});

describe("filters apply identically to Chroma and MiniSearch", () => {
  const chunks = [
    chunk("sa", "growth in South Asia is expected to soften", { region: "South Asia", chapter: 2 }),
    chunk("ssa", "growth in Sub-Saharan Africa is expected to soften", { region: "Sub-Saharan Africa", chapter: 2 }),
    chunk("frag", "growth soften 2.5 2.9", { kind: "table_fragment", region: "South Asia", chapter: 2 }),
    chunk("ch3", "growth soften debt", { chapter: 3 }),
  ];
  const ms = buildBm25(chunks);
  it("region + noise exclusion", () => {
    const f = { region: "South Asia", excludeKinds: ["table_fragment" as const] };
    expect(bm25Search(ms, "growth soften", 10, f).map((r) => r.id)).toEqual(["sa"]);
    expect(toChromaWhere(f)).toEqual({ $and: [{ region: "South Asia" }, { kind: { $nin: ["table_fragment"] } }] });
    expect(matchesFilter({ kind: "body", region: "South Asia" }, f)).toBe(true);
    expect(matchesFilter({ kind: "table_fragment", region: "South Asia" }, f)).toBe(false);
  });
  it("chapter and kinds", () => {
    expect(bm25Search(ms, "growth", 10, { chapter: 3 }).map((r) => r.id)).toEqual(["ch3"]);
    expect(toChromaWhere({ chapter: 3 })).toEqual({ chapter: 3 });
    expect(toChromaWhere({})).toBeUndefined();
  });
});

describe("embedded text", () => {
  it("prefixes the heading path when one exists, leaves stored text unchanged", () => {
    const c = chunk("x", "body text", { headingPath: "Chapter 2: Regional Outlooks > South Asia > Outlook" });
    expect(embeddedText(c)).toBe("Chapter 2: Regional Outlooks > South Asia > Outlook\nbody text");
    expect(c.text).toBe("body text");
    expect(embeddedText(chunk("y", "plain"))).toBe("plain");
  });
});

describe("parent swap", () => {
  const p1 = chunk("p1", "parent one");
  const p2 = chunk("p2", "parent two");
  const p3 = chunk("p3", "parent three");
  const p4 = chunk("p4", "parent four");
  const parents = new Map([p1, p2, p3, p4].map((p) => [p.id, p]));
  it("dedupes by parent in rank order and caps at max", () => {
    const kids = [
      chunk("c1", "", { parentId: "p2" }),
      chunk("c2", "", { parentId: "p2" }),
      chunk("c3", "", { parentId: "p1" }),
      chunk("c4", "", { parentId: "p3" }),
      chunk("c5", "", { parentId: "p4" }),
    ];
    const r = swapChildrenForParents(kids, parents, 3);
    expect(r.passages.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
  });
  it("a chunk without a parent (table) is its own parent", () => {
    const table = chunk("t1", "table", { kind: "table" });
    expect(swapChildrenForParents([table], parents, 3).passages[0]).toBe(table);
  });
});
