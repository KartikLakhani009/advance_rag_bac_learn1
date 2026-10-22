import path from "node:path";
import { DiskCache, hashOf } from "./cache.js";
import { assetDir, assetsForChunks } from "./assets/manifest.js";
import type { Llm } from "./llm.js";
import { ANSWER_PROMPT_VERSION, ANSWER_SYSTEM, answerUser, REFUSAL } from "./prompts.js";
import { QueryResult, type AssetManifest, type Chunk, type Citation, type RankedChunk } from "./schemas.js";

export function pageLabel(c: Pick<Chunk, "printedPage" | "printedPageEnd">): string {
  return c.printedPage === c.printedPageEnd ? `p. ${c.printedPage}` : `p. ${c.printedPage}–${c.printedPageEnd}`;
}

/** Numbered passages labelled with PRINTED pages, e.g. `[1] (p. 74–75, Chapter 2: … > South Asia > Outlook)`. */
export function buildContext(passages: Chunk[]): string {
  return passages.map((c, i) => `[${i + 1}] (${pageLabel(c)}${c.headingPath ? `, ${c.headingPath}` : ""})\n${c.text}`).join("\n\n");
}

export interface GeneratedAnswer {
  answer: string;
  status: "answered" | "not_found";
  citedNs: number[];
}

/**
 * Clean the model's raw reply into the answer contract:
 * - `<think>` tags dropped;
 * - fullwidth brackets 【1】 (gpt-oss) become [1];
 * - mentions of `[Note 10]` become `(Note 10)` so they are never mistaken for passage citations.
 */
export function normaliseAnswer(raw: string): string {
  return raw
    .replace(/<\/?think>/g, "")
    .replace(/\[\s*Notes?\s+(\d+)\s*\]/gi, "(Note $1)")
    .replace(/[【[［]\s*(\d+)\s*[】\]］]/g, "[$1]")
    .trim();
}

/** True when the reply is the exact refusal phrase (optionally quoted), nothing more. */
export function isRefusal(answer: string): boolean {
  const bare = answer.replace(/["“”]/g, "").trim();
  return bare.startsWith(REFUSAL.replace(/\.$/, "")) && bare.length < REFUSAL.length + 12;
}

/** Passage numbers cited as [n] that actually exist, in order of first appearance. */
export function citedPassages(answer: string, passageCount: number): number[] {
  const ns = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= passageCount);
  return [...new Set(ns)];
}

/**
 * Grounded answer from numbered passages. Never pays twice for the same input: cached by
 * (question, exact context, model, prompt version).
 */
export async function generateAnswer(
  llm: Llm,
  question: string,
  passages: Chunk[],
  cache = new DiskCache("answers"),
): Promise<GeneratedAnswer> {
  if (passages.length === 0) return { answer: REFUSAL, status: "not_found", citedNs: [] };
  const context = buildContext(passages);
  const key = hashOf({ question, context, model: llm.model, v: ANSWER_PROMPT_VERSION });
  const hit = cache.get<{ text: string }>(key, llm.model);
  const reply = hit ?? (await llm.complete(ANSWER_SYSTEM, answerUser(question, context)));
  if (!hit) cache.set(key, { text: reply.text });

  const answer = normaliseAnswer(reply.text);
  const refused = isRefusal(answer);
  return {
    answer: refused ? REFUSAL : answer,
    status: refused ? "not_found" : "answered",
    citedNs: citedPassages(answer, passages.length),
  };
}

export function toRanked(c: Chunk, score: number): RankedChunk {
  return {
    chunkId: c.id,
    kind: c.kind,
    page: c.page,
    pageEnd: c.pageEnd,
    printedPage: c.printedPage,
    headingPath: c.headingPath,
    score,
    text: c.text,
  };
}

export function buildQueryResult(args: {
  question: string;
  passages: Chunk[];
  generated: GeneratedAnswer;
  manifest: AssetManifest;
  uc: string;
  trace: QueryResult["trace"];
  debug?: QueryResult["debug"];
}): QueryResult {
  const { passages, generated } = args;
  const ns = generated.status === "not_found" ? [] : generated.citedNs.length ? generated.citedNs : passages.map((_, i) => i + 1);
  const citations: Citation[] = ns.map((n) => {
    const c = passages[n - 1]!;
    return {
      n,
      chunkId: c.id,
      page: c.page,
      pageEnd: c.pageEnd,
      printedPage: c.printedPage,
      printedPageEnd: c.printedPageEnd,
      headingPath: c.headingPath,
    };
  });
  const cited = ns.map((n) => passages[n - 1]!);
  // Table/vision chunks link their page image; parents link via their children's assets
  const ids = cited.flatMap((c) => [c.id, ...(("childIds" in c ? (c as { childIds?: string[] }).childIds : undefined) ?? [])]);
  const assets = assetsForChunks(args.manifest, ids, 4);
  const images = assets.map((a) => ({
    assetId: a.id,
    type: a.type,
    caption: a.caption,
    page: a.page,
    printedPage: a.printedPage,
    file: a.file,
    absolutePath: path.join(assetDir(args.uc), ...a.file.split("/")),
  }));
  return QueryResult.parse({
    question: args.question,
    answer: generated.answer,
    status: generated.status,
    citations,
    images,
    trace: args.trace,
    debug: args.debug,
  });
}
