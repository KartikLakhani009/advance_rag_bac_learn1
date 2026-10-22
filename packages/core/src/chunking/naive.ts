import { countTokens } from "../text/tokens.js";
import { endsOnSentenceBoundary } from "../text/sentences.js";
import type { Chunk } from "../schemas.js";

export interface PageText {
  page: number;
  printedPage: string;
  text: string;
}

/**
 * The baseline: fixed-size character windows over the raw page text, no overlap, blind to sentences,
 * columns or sections. Page range is tracked by character offset so hit@k can still be scored.
 */
export function naiveChunks(pages: PageText[], size = 1000, idPrefix = "naive"): Chunk[] {
  let all = "";
  const starts: Array<{ offset: number; page: number; printedPage: string }> = [];
  for (const p of pages) {
    starts.push({ offset: all.length, page: p.page, printedPage: p.printedPage });
    all += p.text.replace(/\s+/g, " ").trim() + " ";
  }
  const pageAt = (off: number) => {
    let cur = starts[0]!;
    for (const s of starts) if (s.offset <= off) cur = s;
    return cur;
  };
  const out: Chunk[] = [];
  for (let i = 0; i < all.length; i += size) {
    const text = all.slice(i, i + size).trim();
    if (!text) continue;
    const a = pageAt(i);
    const b = pageAt(Math.min(all.length - 1, i + size - 1));
    out.push({
      id: `${idPrefix}-${out.length}`,
      kind: "naive",
      text,
      page: a.page,
      pageEnd: b.page,
      printedPage: a.printedPage,
      printedPageEnd: b.printedPage,
      assetIds: [],
      tokens: countTokens(text),
      endsOnSentence: endsOnSentenceBoundary(text),
    });
  }
  return out;
}
