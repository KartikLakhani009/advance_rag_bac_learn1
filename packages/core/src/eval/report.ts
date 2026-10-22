import fs from "node:fs";
import path from "node:path";
import { REPORTS_DIR } from "../config.js";
import type { ModelUsage } from "../usage.js";
import type { Chunk, EvalQuestion, Metrics, QueryResult } from "../schemas.js";
import { checkAnswer, isHit, fmt } from "./metrics.js";
import type { LadderRow } from "./ladder.js";

export interface QuestionOutcome {
  q: EvalQuestion;
  result: QueryResult;
  /** final ranked chunks (before any parent swap) with their scores */
  ranked: Array<{ chunk: Chunk; score: number }>;
  hitRank: number;
  refusalOk?: boolean;
}

/** Answer check result for one outcome; undefined when the question defines no checks. */
export function answerCheckOf(o: QuestionOutcome) {
  if (o.q.type === "refusal" || (o.q.answerContains.length === 0 && o.q.answerExcludes.length === 0)) return undefined;
  return checkAnswer(o.result.answer, o.q);
}

export interface ReportInput {
  uc: string;
  title: string;
  rerankLabel: string;
  rerankFallback?: string;
  mode: { naive: boolean; ladder: boolean; rerank: boolean };
  metrics: Metrics;
  parentMetrics?: Metrics;
  ladder?: LadderRow[];
  outcomes: QuestionOutcome[];
  usage: Record<string, ModelUsage>;
  notes?: string[];
  /** appended to the report file name, e.g. the index variant */
  tag?: string;
}

const metricRow = (label: string, m: Metrics) => `| ${label} | ${fmt(m.hit1)} | ${fmt(m.hit3)} | ${fmt(m.hit5)} | ${fmt(m.mrr)} | ${m.n} |`;

export function renderReport(r: ReportInput): string {
  const L: string[] = [];
  L.push(`# ${r.title} — evaluation report`, "");
  L.push(`- Generated: ${new Date().toISOString()}`);
  L.push(`- ${r.rerankLabel}${r.rerankFallback ? ` (fell back to fused order on ${r.rerankFallback})` : ""}`);
  L.push(
    `- Chunking: ${r.mode.naive ? "naive 1000-char (baseline)" : "final pipeline"}${r.mode.ladder ? "; ablation ladder included" : ""}`,
    "",
  );
  L.push("> 10–15 hand-checked questions show large effects, not small ones; treat metric differences under ~0.1 as noise.", "");
  for (const n of r.notes ?? []) L.push(`> ${n}`, "");
  L.push("## Retrieval metrics", "", "| Run | hit@1 | hit@3 | hit@5 | MRR | n |", "|---|---|---|---|---|---|");
  L.push(metricRow(r.mode.naive ? "naive" : "final (chunks, before parent swap)", r.metrics));
  if (r.parentMetrics) L.push(metricRow("final (after parent swap)", r.parentMetrics));
  const checked = r.outcomes.map((o) => ({ o, c: answerCheckOf(o) })).filter((x) => x.c);
  if (checked.length)
    L.push(
      "",
      `**Automatic answer checks** (required and forbidden fragments per question): ${checked.filter((x) => x.c!.ok).length}/${checked.length} passed`,
    );
  L.push("");
  if (r.ladder) {
    L.push("## Ablation ladder", "", "| Step | Technique | hit@1 | hit@3 | hit@5 | MRR |", "|---|---|---|---|---|---|");
    for (const row of r.ladder) {
      if (!row.metrics) L.push(`| ${row.id} | ${row.label} | skipped | skipped | skipped | skipped |`);
      else {
        const m = row.metrics;
        L.push(`| ${row.id} | ${row.label} | ${fmt(m.hit1)} | ${fmt(m.hit3)} | ${fmt(m.hit5)} | ${fmt(m.mrr)} |`);
        if (row.parentMetrics) {
          const p = row.parentMetrics;
          L.push(
            `| ${row.id} (parents) | ${row.label}, scored after the parent swap | ${fmt(p.hit1)} | ${fmt(p.hit3)} | ${fmt(p.hit5)} | ${fmt(p.mrr)} |`,
          );
        }
      }
    }
    const skipped = r.ladder.filter((x) => x.skipped);
    if (skipped.length) L.push("", ...skipped.map((s) => `- Step ${s.id} skipped: ${s.skipped}`));
    L.push("");
  }
  L.push("## Questions", "");
  for (const o of r.outcomes) {
    L.push(`### ${o.q.id} (${o.q.type}) — ${o.q.question}`, "");
    L.push(`- **Expected:** ${o.q.expected}`);
    L.push(
      `- **Gold pages (PDF):** ${o.q.goldPages.length ? o.q.goldPages.join(", ") : "—"}${o.q.evidence ? `; evidence: "${o.q.evidence}"` : ""}`,
    );
    L.push(`- **Answer:** ${o.result.answer}`);
    const ac = answerCheckOf(o);
    if (ac)
      L.push(
        `- **Answer check:** ${ac.ok ? "PASS" : "FAIL"}${ac.missing.length ? `; missing: ${ac.missing.join(", ")}` : ""}${ac.forbidden.length ? `; forbidden present: ${ac.forbidden.join(", ")}` : ""}`,
      );
    L.push(
      `- **Status:** ${o.result.status}${o.q.type === "refusal" ? ` (exact refusal phrase: ${o.refusalOk ? "yes" : "NO"})` : `; first hit rank: ${o.hitRank || "none in final list"}`}`,
    );
    L.push(
      `- **Citations:** ${o.result.citations.map((c) => `[${c.n}] p. ${c.printedPage === c.printedPageEnd ? c.printedPage : `${c.printedPage}–${c.printedPageEnd}`} (PDF ${c.page}${c.pageEnd !== c.page ? `–${c.pageEnd}` : ""})`).join("; ") || "—"}`,
    );
    L.push("- **Trace:**", ...o.result.trace.map((t) => `  - ${t.stage}: ${t.note}`));
    L.push(
      "",
      "Final chunks:",
      "",
      "| # | kind | PDF | printed | heading path | score | hit | text |",
      "|---|---|---|---|---|---|---|---|",
    );
    o.ranked.forEach(({ chunk: c, score }, i) => {
      const text = c.text.replace(/\s+/g, " ").slice(0, 300).replace(/\|/g, "\\|");
      L.push(
        `| ${i + 1} | ${c.kind} | ${c.page}${c.pageEnd !== c.page ? `–${c.pageEnd}` : ""} | ${c.printedPage}${c.printedPageEnd !== c.printedPage ? `–${c.printedPageEnd}` : ""} | ${(c.headingPath ?? "").replace(/\|/g, "\\|")} | ${score.toFixed(4)} | ${o.q.type === "refusal" ? "–" : isHit(c, o.q) ? "✔" : "✘"} | ${text} |`,
      );
    });
    L.push("");
    if (o.result.images.length) L.push(`Images: ${o.result.images.map((i) => `${i.file} (p. ${i.printedPage})`).join(", ")}`, "");
    L.push("| Verdict | Notes |", "|---|---|", "| Pass / Fail |  |", "");
  }
  L.push("## Usage", "", "| Model | requests | input tokens | output tokens | cache hits |", "|---|---|---|---|---|");
  for (const [m, u] of Object.entries(r.usage)) L.push(`| ${m} | ${u.requests} | ${u.inputTokens} | ${u.outputTokens} | ${u.cacheHits} |`);
  L.push("");
  return L.join("\n");
}

export function writeReport(r: ReportInput): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `${r.uc}-${ts}${r.mode.naive ? "-naive" : ""}${r.mode.ladder ? "-ladder" : ""}${r.mode.rerank ? "-rerank" : ""}${r.tag ? `-${r.tag}` : ""}.md`;
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const file = path.join(REPORTS_DIR, name);
  fs.writeFileSync(file, renderReport(r));
  return file;
}
