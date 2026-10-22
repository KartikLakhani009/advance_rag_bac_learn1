import * as mupdf from "mupdf";

/** Render a full page to PNG at the given DPI. */
export function renderPagePng(doc: mupdf.Document, pageNo: number, dpi = 110): Uint8Array {
  const page = doc.loadPage(pageNo - 1);
  const s = dpi / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
  return pix.asPNG();
}

/** Render a region (PDF points, y-down) of a page to PNG. */
export function renderRegionPng(
  doc: mupdf.Document,
  pageNo: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  dpi = 150,
): Uint8Array {
  const page = doc.loadPage(pageNo - 1);
  const s = dpi / 72;
  const m = mupdf.Matrix.scale(s, s);
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, mupdf.Rect.transform([bbox.x0, bbox.y0, bbox.x1, bbox.y1], m), false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
  page.run(dev, m);
  dev.close();
  return pix.asPNG();
}
