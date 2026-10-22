import { countTokens } from "../text/tokens.js";
import { endsOnSentenceBoundary, splitSentences } from "../text/sentences.js";
import type { Chunk, ChunkKind } from "../schemas.js";

export interface SentenceUnit {
  text: string;
  page: number;
  printedPage: string;
  tokens: number;
}

export function toSentenceUnits(text: string, page: number, printedPage: string): SentenceUnit[] {
  return splitSentences(text).map((s) => ({ text: s, page, printedPage, tokens: countTokens(s) }));
}

export interface WindowOptions {
  targetTokens: number;
  overlapTokens: number;
}

/**
 * Pack whole sentences into windows of ~targetTokens. The last sentences of a window (up to
 * overlapTokens) are carried into the next one, so a fact near a boundary appears whole somewhere.
 * A sentence longer than the target becomes its own window. Returns index ranges into `units`.
 */
export function windowSentences(units: SentenceUnit[], opts: WindowOptions): Array<[number, number]> {
  const wins: Array<[number, number]> = [];
  let start = 0;
  while (start < units.length) {
    let end = start;
    let tok = 0;
    while (end < units.length && (end === start || tok + units[end]!.tokens <= opts.targetTokens)) {
      tok += units[end]!.tokens;
      end++;
    }
    wins.push([start, end]);
    if (end >= units.length) break;
    // carry-over: walk back from `end` while the overlap budget allows, but always make progress
    let back = end;
    let ov = 0;
    while (back > start + 1 && ov + units[back - 1]!.tokens <= opts.overlapTokens) {
      ov += units[back - 1]!.tokens;
      back--;
    }
    start = back > start ? back : end;
    if (start >= end) start = end;
  }
  return wins;
}

export interface SentenceChunkOptions extends WindowOptions {
  idPrefix: string;
  kind: ChunkKind;
}

export function sentenceChunks(units: SentenceUnit[], opts: SentenceChunkOptions): Chunk[] {
  return windowSentences(units, opts).map(([a, b], i) => {
    const slice = units.slice(a, b);
    const text = slice.map((u) => u.text).join(" ");
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;
    return {
      id: `${opts.idPrefix}-${i}`,
      kind: opts.kind,
      text,
      page: first.page,
      pageEnd: last.page,
      printedPage: first.printedPage,
      printedPageEnd: last.printedPage,
      assetIds: [],
      tokens: countTokens(text),
      endsOnSentence: endsOnSentenceBoundary(text),
    };
  });
}
