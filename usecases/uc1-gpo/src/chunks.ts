import path from "node:path";
import { naiveChunks } from "@rag/core/src/chunking/naive.js";
import { flowToUnits } from "@rag/core/src/chunking/flow.js";
import { sentenceChunks } from "@rag/core/src/chunking/sentence.js";
import { RAW_DIR } from "@rag/core/src/config.js";
import { loadDocument, type LoadedDoc } from "@rag/core/src/pdf/document.js";
import { buildElements, rawPageTexts, type BuiltDoc } from "@rag/core/src/pdf/elements.js";
import type { Chunk } from "@rag/core/src/schemas.js";

export const UC = "uc1";
export const PDF = path.join(RAW_DIR, "GPO-Anual-report.pdf");

export interface Uc1Doc {
  doc: LoadedDoc;
  built: BuiltDoc;
}

export function loadUc1(): Uc1Doc {
  const doc = loadDocument("gpo", PDF);
  return { doc, built: buildElements(doc) };
}

/** A: raw page text, 1000-char windows. */
export function buildNaive(u: Uc1Doc): Chunk[] {
  return naiveChunks(rawPageTexts(u.doc), 1000, "uc1-naive");
}

/** B: whole sentences, ~450 tokens, ~60-token overlap, page ranges tracked (PDF + printed). */
export function buildSentence(u: Uc1Doc): Chunk[] {
  const items = u.built.pages.flatMap((p) => p.elements.map((el) => ({ el, page: p.page, printedPage: p.printedPage })));
  const units = flowToUnits(items, u.built.vocab);
  return sentenceChunks(units, { targetTokens: 450, overlapTokens: 60, idPrefix: "uc1-s", kind: "sentence" });
}
