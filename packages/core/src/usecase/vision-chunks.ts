import { savePageAsset } from "../assets/extract.js";
import type { AssetWriter } from "../assets/manifest.js";
import { createLogger } from "../logger.js";
import type { LoadedDoc } from "../pdf/document.js";
import type { Chunk, VisionPagesConfig } from "../schemas.js";
import { describePage, type VisionClient } from "../vision.js";
import { countTokens } from "../text/tokens.js";

const log = createLogger("vision");

export interface VisionChunkOptions {
  uc: string;
  doc: LoadedDoc;
  config: VisionPagesConfig;
  client: VisionClient;
  model: string;
  assets: AssetWriter;
  kind: "vision" | "table";
  /** heading path for the chunk, from page + config note */
  headingFor?: (page: number, printedPage: string, note?: string) => string | undefined;
  /** extra metadata (chapter/region) for a page */
  metaFor?: (page: number) => Partial<Chunk>;
}

/**
 * One chunk per listed page. ONLY pages in vision-pages.json are sent to Gemini; everything else never is.
 * saveAsset pages also get a PNG asset (figure crop when the layout shows one, otherwise the page) linked to the chunk.
 */
export async function buildVisionChunks(o: VisionChunkOptions): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for (const entry of o.config.pages) {
    const p = o.doc.pages[entry.page - 1]!;
    if (entry.printedPage && entry.printedPage !== p.printedPage) {
      log.warn(`page ${entry.page}: config says printed ${entry.printedPage} but the document maps it to ${p.printedPage}`);
    }
    const pageText = p.lines.map((l) => l.clean).join("\n");
    const d = await describePage(o.doc.pdf, entry.page, pageText, { client: o.client, model: o.model, namespace: o.uc });
    const id = `${o.uc}-v${entry.page}`;
    const chunk: Chunk = {
      id,
      kind: o.kind,
      text: d.text,
      page: entry.page,
      pageEnd: entry.page,
      printedPage: p.printedPage,
      printedPageEnd: p.printedPage,
      headingPath: o.headingFor
        ? o.headingFor(entry.page, p.printedPage, entry.note)
        : `Page ${p.printedPage}${entry.note ? `: ${entry.note}` : ""}`,
      assetIds: [],
      tokens: countTokens(d.text),
      endsOnSentence: true,
      ...(o.metaFor?.(entry.page) ?? {}),
    };
    if (entry.saveAsset) {
      const a = savePageAsset(o.assets, o.doc.pdf, p, d.png, {
        name: `${o.uc}-p${entry.page}`,
        caption: entry.note ?? `Page ${p.printedPage}`,
        chunkIds: [id],
      });
      chunk.assetIds.push(a.id);
    }
    out.push(chunk);
  }
  return out;
}
