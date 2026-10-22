import type { Chunk, EvalQuestion, Metrics } from "../schemas.js";

const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

/** A chunk is a hit when its PDF page range overlaps goldPages and (if set) its text contains the evidence. */
export function isHit(c: Pick<Chunk, "page" | "pageEnd" | "text">, q: Pick<EvalQuestion, "goldPages" | "evidence">): boolean {
  const pageOk = q.goldPages.length === 0 || q.goldPages.some((g) => g >= c.page && g <= c.pageEnd);
  if (!pageOk) return false;
  if (q.evidence && !norm(c.text).includes(norm(q.evidence))) return false;
  return true;
}

/** Rank (1-based) of the first hit, or 0. */
export function firstHitRank(
  ranked: Array<Pick<Chunk, "page" | "pageEnd" | "text">>,
  q: Pick<EvalQuestion, "goldPages" | "evidence">,
): number {
  const i = ranked.findIndex((c) => isHit(c, q));
  return i < 0 ? 0 : i + 1;
}

export function computeMetrics(ranks: number[]): Metrics {
  const n = ranks.length;
  if (n === 0) return { hit1: 0, hit3: 0, hit5: 0, mrr: 0, n: 0 };
  const at = (k: number) => ranks.filter((r) => r > 0 && r <= k).length / n;
  return { hit1: at(1), hit3: at(3), hit5: at(5), mrr: ranks.reduce((s, r) => s + (r > 0 ? 1 / r : 0), 0) / n, n };
}

export const fmt = (x: number) => x.toFixed(2);

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s*%/g, "%")
    .replace(/(\d)\s+(?=[a-z%])/g, "$1") // "256 GB" = "256GB", "0.57 W" = "0.57W"
    .replace(/\s+/g, " ");

export interface AnswerCheck {
  ok: boolean;
  missing: string[];
  forbidden: string[];
}

/** Automatic answer check: required fragments present, forbidden fragments absent. */
export function checkAnswer(answer: string, q: Pick<EvalQuestion, "answerContains" | "answerExcludes">): AnswerCheck {
  const a = squash(answer);
  const missing = q.answerContains.filter((req) => !req.split("|").some((alt) => a.includes(squash(alt.trim()))));
  const forbidden = q.answerExcludes.filter((bad) => a.includes(squash(bad)));
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}
