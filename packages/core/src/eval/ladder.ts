import type { Chunk, EvalQuestion, Metrics } from "../schemas.js";
import { computeMetrics, firstHitRank } from "./metrics.js";

export interface LadderStep {
  id: string;
  label: string;
  /** Final ranked chunks for a question; omitted when the step is skipped. */
  run?: (q: EvalQuestion) => Promise<Chunk[]>;
  /** Optional second list scored after the parent swap (UC2 steps 6+). */
  runParents?: (q: EvalQuestion) => Promise<Chunk[]>;
  skipped?: string;
  note?: string;
}

export interface LadderRow {
  id: string;
  label: string;
  metrics?: Metrics;
  parentMetrics?: Metrics;
  skipped?: string;
  note?: string;
}

/** Score every step over the non-refusal questions: hit@1/3/5 and MRR on the final ranked list. */
export async function runLadder(steps: LadderStep[], questions: EvalQuestion[], onStep?: (s: LadderStep) => void): Promise<LadderRow[]> {
  const scored = questions.filter((q) => q.type !== "refusal");
  const rows: LadderRow[] = [];
  for (const s of steps) {
    onStep?.(s);
    if (s.skipped || !s.run) {
      rows.push({ id: s.id, label: s.label, skipped: s.skipped ?? "skipped", note: s.note });
      continue;
    }
    const ranks: number[] = [];
    const pranks: number[] = [];
    for (const q of scored) {
      ranks.push(firstHitRank(await s.run(q), q));
      if (s.runParents) pranks.push(firstHitRank(await s.runParents(q), q));
    }
    rows.push({
      id: s.id,
      label: s.label,
      metrics: computeMetrics(ranks),
      parentMetrics: s.runParents ? computeMetrics(pranks) : undefined,
      note: s.note,
    });
  }
  return rows;
}
