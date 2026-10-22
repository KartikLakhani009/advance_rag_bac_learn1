import type { Section, SectionMeta } from "@rag/core/src/chunking/hierarchy.js";
import { flowToUnits, type FlowItem } from "@rag/core/src/chunking/flow.js";
import type { LoadedDoc } from "@rag/core/src/pdf/document.js";
import { buildElements, type BuiltDoc } from "@rag/core/src/pdf/elements.js";
import { joinLines } from "@rag/core/src/pdf/repair.js";
import { REGIONS, type ChunkKind, type Element } from "@rag/core/src/schemas.js";

export const CHAPTERS: Record<number, string> = {
  1: "Global Outlook",
  2: "Regional Outlooks",
  3: "Sovereign Debt Levels and Interest Rates in EMDEs",
  4: "Fiscal Policy and Commodity Price Swings",
};

/**
 * Typography thresholds tuned to GEP June 2026 (verified against real pages, see the understanding doc):
 * body AGaramondPro 11 (10.6 in boxes), headings HelveticaLTStd. Change them for another PDF.
 */
export const TYPO = {
  sectionMinSize: 14,
  titleMinSize: 20,
  smallMaxSize: 9.2,
  subsectionMin: 10,
  subsectionMax: 12.5,
  subsectionMaxChars: 90,
  /** box body is 10.6pt, main body 11pt */
  boxBodyMax: 10.9,
};

export type LineClass = "caption" | "section" | "subsection" | "small" | "body" | "title";

const isHelvetica = (font: string | undefined) => /helvetica/i.test(font ?? "");
const CAPTION = /^(BOX|TABLE|FIGURE)\s+\d/;

/** Classify one element (paragraph) by the typography of its first line. */
export function classify(el: Pick<Element, "text" | "font" | "size" | "bold">): LineClass {
  const size = el.size ?? 11;
  const text = el.text.trim();
  if (size >= TYPO.titleMinSize) return "title";
  if (CAPTION.test(text) && el.bold && isHelvetica(el.font)) return "caption";
  if (el.bold && isHelvetica(el.font) && size >= TYPO.sectionMinSize) return "section";
  if (size < TYPO.smallMaxSize) return "small";
  if (
    isHelvetica(el.font) &&
    !el.bold &&
    size >= TYPO.subsectionMin &&
    size <= TYPO.subsectionMax &&
    text.length < TYPO.subsectionMaxChars &&
    !text.endsWith(".")
  )
    return "subsection";
  return "body";
}

interface Ctx {
  chapter?: number;
  region?: string;
  section?: string;
  subsection?: string;
  box?: string;
  boxTitle?: string;
  mode: "front" | "exec" | "main" | "refs" | "appendix" | "back";
}

export interface Structured {
  sections: Section[];
  /** small-font text-layer fragments and other noise, never indexed */
  noise: Array<{ page: number; kind: ChunkKind; text: string }>;
  /** per PDF page: chapter/region at the END of the page (table pages inherit it) */
  pageContext: Map<number, { chapter?: number; region?: string }>;
  stats: Record<string, number>;
}

function headingPath(c: Ctx): string | undefined {
  const parts: string[] = [];
  if (c.mode === "exec") return "Executive Summary";
  if (c.mode === "appendix") parts.push("Statistical Appendix");
  if (c.chapter) parts.push(`Chapter ${c.chapter}: ${CHAPTERS[c.chapter]}`);
  if (c.region) parts.push(c.region);
  if (c.box) parts.push(`Box ${c.box}${c.boxTitle ? `: ${c.boxTitle}` : ""}`);
  else if (c.section && c.section !== c.region) parts.push(c.section);
  if (c.subsection) parts.push(c.subsection);
  return parts.length ? parts.join(" > ") : undefined;
}

function kindOf(c: Ctx): ChunkKind {
  if (c.mode === "front" || c.mode === "back") return "front_matter";
  if (c.mode === "exec") return "executive_summary";
  if (c.mode === "refs") return "references";
  if (c.box) return "box";
  return "body";
}

/** Walk the document once, tracking chapter/region/section/box from fonts, and cut it into sections. */
export function structureDocument(doc: LoadedDoc, built?: BuiltDoc): Structured {
  const b = built ?? buildElements(doc);
  const ctx: Ctx = { mode: "front" };
  const sections: Section[] = [];
  const noise: Structured["noise"] = [];
  const pageContext: Structured["pageContext"] = new Map();
  const stats: Record<string, number> = {};
  let cur: { key: string; meta: SectionMeta; items: FlowItem[] } | undefined;
  let n = 0;

  const flush = () => {
    if (cur && cur.items.length) {
      sections.push({ id: `uc2-s${n++}`, meta: cur.meta, units: flowToUnits(cur.items, b.vocab) });
    }
    cur = undefined;
  };
  const push = (el: Element, page: number, printedPage: string) => {
    const meta: SectionMeta = {
      kind: kindOf(ctx),
      headingPath: headingPath(ctx),
      chapter: ctx.chapter,
      chapterTitle: ctx.chapter ? CHAPTERS[ctx.chapter] : undefined,
      region: ctx.region,
      box: ctx.box,
    };
    const key = JSON.stringify(meta);
    if (!cur || cur.key !== key) {
      flush();
      cur = { key, meta, items: [] };
    }
    cur.items.push({ el, page, printedPage });
    stats[meta.kind] = (stats[meta.kind] ?? 0) + 1;
  };

  for (const page of b.pages) {
    const dp = doc.pages[page.page - 1]!;
    const topLines = dp.raw.lines.filter((l) => l.y1 < dp.raw.height * 0.1);
    const hdr = topLines.map((l) => l.text.trim());
    const chHeader = hdr.map((t) => /^CHAPTER\s+([1-4])$/.exec(t)).find(Boolean);
    const isDivider = dp.raw.lines.some((l) => l.size >= 26 && /^CHAPTER\s+[1-4]$/.test(l.text.trim()));
    if (chHeader) ctx.chapter = Number(chHeader[1]);
    if (isDivider) {
      const m = dp.raw.lines.find((l) => l.size >= 26 && /^CHAPTER\s+[1-4]$/.test(l.text.trim()))!;
      ctx.chapter = Number(/\d/.exec(m.text)![0]);
      ctx.mode = "front"; // divider pages carry titles only
      ctx.region = ctx.section = ctx.subsection = ctx.box = undefined;
    }
    if (hdr.some((t) => /^STATISTICAL APPENDIX$/.test(t)) && ctx.mode !== "appendix") {
      ctx.mode = "appendix";
      ctx.chapter = undefined;
      ctx.region = ctx.section = ctx.subsection = ctx.box = undefined;
    }
    if (hdr.some((t) => /^SELECTED TOPICS$/.test(t))) ctx.mode = "back";
    if (chHeader && (ctx.mode === "front" || ctx.mode === "exec") && page.page >= 23) ctx.mode = "main";

    for (const el of page.elements) {
      const cls = classify(el);
      const text = el.text.trim();
      if (!text) continue;
      if (cls === "title") {
        if (/^Executive Summary$/i.test(text)) {
          ctx.mode = "exec";
          ctx.chapter = undefined;
          ctx.region = ctx.section = ctx.subsection = ctx.box = undefined;
        } else if (page.page < 23) ctx.mode = "front";
        continue;
      }
      if (ctx.mode === "back") {
        noise.push({ page: page.page, kind: "front_matter", text });
        continue;
      }
      if (cls === "small") {
        noise.push({ page: page.page, kind: ctx.mode === "front" ? "front_matter" : "table_fragment", text });
        continue;
      }
      if (ctx.mode === "front") {
        noise.push({ page: page.page, kind: "front_matter", text });
        continue;
      }
      if (cls === "section") {
        flush();
        const t = text;
        const region = ctx.chapter === 2 ? REGIONS.find((r) => r === t) : undefined;
        ctx.box = ctx.boxTitle = undefined;
        ctx.subsection = undefined;
        if (/^References$/i.test(t)) {
          ctx.mode = "refs";
          ctx.region = undefined;
          ctx.section = t;
        } else {
          if (ctx.mode === "refs") ctx.mode = ctx.chapter ? "main" : ctx.mode;
          ctx.region = region ?? (ctx.chapter === 2 ? undefined : ctx.region);
          ctx.section = t;
        }
        continue;
      }
      // Boxes are set in 10.6pt Garamond; the main text is 11pt. Back to 11pt body text = the box is over.
      if (ctx.box && cls === "body" && (el.size ?? 0) >= TYPO.boxBodyMax) {
        flush();
        ctx.box = ctx.boxTitle = undefined;
      }
      if (cls === "subsection" && ctx.mode !== "refs") {
        flush();
        ctx.subsection = text;
        continue;
      }
      if (cls === "caption") {
        const m = /^BOX\s+(\d+\.\d+)\s*(.*)$/.exec(text);
        if (m) {
          if (ctx.box !== m[1]) {
            flush();
            ctx.box = m[1];
            ctx.boxTitle = joinLines([m[2] ?? ""]).slice(0, 90);
            ctx.subsection = undefined;
          }
          continue; // the box caption is a heading, not content
        }
      }
      push(el, page.page, page.printedPage);
    }
    pageContext.set(page.page, { chapter: ctx.chapter, region: ctx.region });
  }
  flush();
  return { sections, noise, pageContext, stats };
}

/** Table number(s) printed on a page ("Table 2.9, Table 2.10"), for table-chunk heading paths. */
export function tableLabels(doc: LoadedDoc, page: number): string[] {
  const dp = doc.pages[page - 1]!;
  const nums = dp.raw.lines.map((l) => /^TABLE\s+(\d+\.\d+)/.exec(l.text.trim())?.[1]).filter((x): x is string => !!x);
  return [...new Set(nums)].sort((a, c) => Number(a.split(".")[1]) - Number(c.split(".")[1])).map((x) => `Table ${x}`);
}
