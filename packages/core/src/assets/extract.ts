import type * as mupdf from "mupdf";
import type { DocPage } from "../pdf/document.js";
import { renderRegionPng } from "../pdf/render.js";
import type { Asset, BBox } from "../schemas.js";
import type { AssetWriter } from "./manifest.js";

const FIG_CAPTION = /^(BOX|TABLE|FIGURE)\s+\d/;

/**
 * Figure block bbox: caption line ("FIGURE 1.3 …") through the "Source:" note, full text width.
 * Returns undefined when the layout has no such block (the whole page is saved instead).
 */
export function findFigureBBox(p: DocPage): BBox | undefined {
  const lines = p.raw.lines;
  const cap = lines.find((l) => FIG_CAPTION.test(l.text.trim()) && l.bold);
  if (!cap) return undefined;
  const source = lines.filter((l) => /^(Sources?|Note[s]?)\b[:.]/.test(l.text.trim()) && l.y0 > cap.y1).sort((a, b) => b.y1 - a.y1)[0];
  if (!source) return undefined;
  const x0 = Math.min(cap.x0, ...lines.filter((l) => l.y0 >= cap.y0 && l.y1 <= source.y1).map((l) => l.x0)) - 4;
  const x1 = Math.max(source.x1, ...lines.filter((l) => l.y0 >= cap.y0 && l.y1 <= source.y1).map((l) => l.x1)) + 4;
  return { x0: Math.max(0, x0), y0: Math.max(0, cap.y0 - 4), x1: Math.min(p.raw.width, x1), y1: Math.min(p.raw.height, source.y1 + 4) };
}

/** Save a vision page as an asset: the figure block when found, otherwise the whole page. */
export function savePageAsset(
  w: AssetWriter,
  doc: mupdf.Document,
  p: DocPage,
  fullPagePng: Uint8Array,
  opts: { name: string; caption: string; chunkIds: string[] },
) {
  const bbox = findFigureBBox(p);
  const png = bbox ? renderRegionPng(doc, p.page, bbox, 150) : fullPagePng;
  return w.add({
    id: opts.name,
    name: opts.name,
    type: bbox ? "figure" : "page",
    page: p.page,
    printedPage: p.printedPage,
    bbox,
    caption: opts.caption,
    decorative: false,
    png,
    chunkIds: opts.chunkIds,
  });
}

/**
 * Embedded raster images (photos). Tiny ones (icons, rules) are skipped. A photo with a small caption line
 * just below it is a captioned photo; otherwise it is decorative: saved, never linked.
 */
export function extractPhotos(
  w: AssetWriter,
  doc: mupdf.Document,
  pages: DocPage[],
  opts: { prefix: string; pageFilter?: (p: number) => boolean },
) {
  const out: Asset[] = [];
  for (const p of pages) {
    if (opts.pageFilter && !opts.pageFilter(p.page)) continue;
    p.raw.images.forEach((im, i) => {
      const bw = im.x1 - im.x0;
      const bh = im.y1 - im.y0;
      if (bw < 90 || bh < 90 || bw * bh > p.raw.width * p.raw.height * 0.9) return;
      const cap = p.raw.lines
        .filter(
          (l) => l.size <= 9 && l.y0 >= im.y1 - 2 && l.y0 - im.y1 < 24 && l.x0 >= im.x0 - 20 && l.x1 <= im.x1 + 20 && l.text.length > 25,
        )
        .sort((a, b) => a.y0 - b.y0)[0];
      const png = renderRegionPng(doc, p.page, im, 110);
      out.push(
        w.add({
          id: `${opts.prefix}-p${p.page}-img${i}`,
          name: `${opts.prefix}-p${p.page}-img${i}`,
          type: "photo",
          page: p.page,
          printedPage: p.printedPage,
          bbox: im,
          caption: cap?.text.trim() ?? "",
          decorative: !cap,
          png,
        }),
      );
    });
  }
  return out;
}
