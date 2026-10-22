import fs from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { EvalQuestionFile, type EvalQuestion } from "../schemas.js";
import { REFUSAL } from "../prompts.js";
import { createLogger } from "../logger.js";
import { usageDelta, usageSnapshot } from "../usage.js";
import type { UseCaseApp } from "../usecase/app.js";
import { computeMetrics, firstHitRank } from "./metrics.js";
import { runLadder, type LadderStep } from "./ladder.js";
import { writeReport, type QuestionOutcome } from "./report.js";

const log = createLogger("eval");

export function loadQuestions(file: string): EvalQuestion[] {
  const parsed = EvalQuestionFile.safeParse(YAML.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`${file} is invalid: ${z.prettifyError(parsed.error)}`);
  return parsed.data.questions;
}

export interface EvalOptions {
  uc: string;
  title: string;
  app: UseCaseApp;
  questions: EvalQuestion[];
  rerankLabel: string;
  rerankOn: boolean;
  naive: boolean;
  ladder?: LadderStep[];
  notes?: string[];
  /** UC2: also score after the parent swap */
  scoreParents?: boolean;
  tag?: string;
  /** skip answer generation (no LLM tokens); only the ladder is scored */
  retrievalOnly?: boolean;
}

/** Run every question one at a time (rate limits), score retrieval, optionally the ladder, write the report. */
export async function runEval(o: EvalOptions): Promise<string> {
  const before = usageSnapshot();
  const outcomes: QuestionOutcome[] = [];
  const pRanks: number[] = [];
  let fallback: string | undefined;
  for (const q of o.retrievalOnly ? [] : o.questions) {
    log.info(`${q.id}: ${q.question}`);
    const out = await o.app.ask(q.question);
    if (out.rerankError) fallback = out.rerankError.slice(0, 80);
    const hitRank =
      q.type === "refusal"
        ? 0
        : firstHitRank(
            out.ranked.map((r) => r.chunk),
            q,
          );
    if (o.scoreParents && q.type !== "refusal") pRanks.push(firstHitRank(out.passages, q));
    outcomes.push({
      q,
      result: out.result,
      ranked: out.ranked,
      hitRank,
      refusalOk: q.type === "refusal" ? out.result.answer.trim() === REFUSAL : undefined,
    });
    log.info(`  → ${out.result.status}, first hit rank ${hitRank || "none"}`);
  }
  const scored = outcomes.filter((x) => x.q.type !== "refusal");
  const metrics = computeMetrics(scored.map((x) => x.hitRank));
  const ladder = o.ladder ? await runLadder(o.ladder, o.questions, (s) => log.info(`ladder step ${s.id}: ${s.label}`)) : undefined;
  const refusals = outcomes.filter((x) => x.q.type === "refusal");
  const notes = [...(o.notes ?? [])];
  if (o.retrievalOnly) notes.push("Retrieval-only run: no answers were generated (no LLM tokens spent); only the ladder is scored.");
  if (refusals.length)
    notes.push(`Refusal questions: ${refusals.filter((r) => r.refusalOk).length}/${refusals.length} produced the exact refusal phrase.`);
  return writeReport({
    uc: o.uc,
    title: o.title,
    rerankLabel: o.rerankLabel,
    rerankFallback: fallback,
    mode: { naive: o.naive, ladder: !!o.ladder, rerank: o.rerankOn },
    metrics,
    parentMetrics: o.scoreParents ? computeMetrics(pRanks) : undefined,
    ladder,
    outcomes,
    usage: usageDelta(before, usageSnapshot()),
    notes,
    tag: o.retrievalOnly ? [o.tag, "retrieval"].filter(Boolean).join("-") : o.tag,
  });
}
