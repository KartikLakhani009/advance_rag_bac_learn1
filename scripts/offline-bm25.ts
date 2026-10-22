/**
 * Offline BM25-only ablation (no API keys, no Chroma): hit@k / MRR per chunking variant.
 * It isolates what chunking alone buys, before dense retrieval, vision and rerank are added.
 *   npm run offline:bm25
 */
import path from "node:path";
import { buildBm25, bm25Search } from "@rag/core/src/retrieve/bm25.js";
import { swapChildrenForParents } from "@rag/core/src/retrieve/parents.js";
import { computeMetrics, firstHitRank, fmt } from "@rag/core/src/eval/metrics.js";
import { loadQuestions } from "@rag/core/src/eval/run.js";
import type { Chunk, EvalQuestion } from "@rag/core/src/schemas.js";
import * as uc1 from "../usecases/uc1-gpo/src/chunks.js";
import * as uc2 from "../usecases/uc2-gep/src/chunks.js";
import { routeByRules, toFilter } from "../usecases/uc2-gep/src/regions.js";
import * as uc3 from "../usecases/uc3-imac/src/chunks.js";
import { withEndnotes } from "@rag/core/src/chunking/elements.js";

const K = 20;
const FINAL = 5;
const qs = (uc: string) => loadQuestions(path.join("usecases", uc, "eval", "questions.yaml")).filter((q) => q.type !== "refusal");

function score(name: string, questions: EvalQuestion[], rank: (q: EvalQuestion) => Chunk[]) {
  const m = computeMetrics(questions.map((q) => firstHitRank(rank(q), q)));
  console.log(`| ${name} | ${fmt(m.hit1)} | ${fmt(m.hit3)} | ${fmt(m.hit5)} | ${fmt(m.mrr)} | ${m.n} |`);
}
const head = (t: string) =>
  console.log(`\n### ${t}\n\n| Variant (BM25 only) | hit@1 | hit@3 | hit@5 | MRR | n |\n|---|---|---|---|---|---|`);
const searcher = (chunks: Chunk[]) => {
  const ms = buildBm25(chunks);
  const by = new Map(chunks.map((c) => [c.id, c]));
  return (q: string, f?: Parameters<typeof bm25Search>[3]) => bm25Search(ms, q, K, f).map((r) => by.get(r.id)!);
};

// UC1
{
  const u = uc1.loadUc1();
  const naive = uc1.buildNaive(u);
  const sent = uc1.buildSentence(u);
  const share = (c: Chunk[]) => `${c.filter((x) => x.endsOnSentence).length}/${c.length}`;
  head(`UC1 — GPO (chunks ending on a sentence boundary: naive ${share(naive)}, sentence ${share(sent)})`);
  const q = qs("uc1-gpo");
  const sn = searcher(naive),
    ss = searcher(sent);
  score("A naive 1000-char", q, (x) => sn(x.question).slice(0, FINAL));
  score("B sentence chunks", q, (x) => ss(x.question).slice(0, FINAL));
}
// UC2
{
  const u = uc2.loadUc2();
  const naive = uc2.buildNaive(u);
  const { parents, children } = uc2.buildHier(u);
  const q = qs("uc2-gep");
  const sn = searcher(naive),
    sc = searcher(uc2.stripHeadingPath(children)),
    sh = searcher(children);
  head(`UC2 — GEP (${naive.length} naive, ${children.length} children, ${parents.length} parents)`);
  score("1 naive 1000-char", q, (x) => sn(x.question).slice(0, FINAL));
  score("2 section-aware children (text only)", q, (x) => sc(x.question).slice(0, FINAL));
  score("3 + heading path in the index text", q, (x) => sh(x.question).slice(0, FINAL));
  const routed = (x: EvalQuestion) => {
    const r = routeByRules(x.question);
    const hit = sh(x.question, toFilter(r));
    const hasC = !!(r.region || r.chapter || r.executive_summary || r.box);
    return hasC && hit.length < 3 ? sh(x.question, toFilter({ region: null, chapter: null, executive_summary: false, box: false })) : hit;
  };
  score("5 + routing (rules) with fallback", q, (x) => routed(x).slice(0, FINAL));
  const pm = new Map(parents.map((p) => [p.id, p]));
  score("6 + parents (scored on parent sections)", q, (x) => swapChildrenForParents(routed(x).slice(0, FINAL), pm, 3).passages);
}
// UC3
{
  const u = uc3.loadUc3();
  const naive = uc3.buildNaive(u);
  const sent = uc3.buildSentenceRecipe(u).map((c) => withEndnotes(c, u.endnotes));
  const els = uc3.buildElementChunks(u);
  const q = qs("uc3-imac");
  head(`UC3 — iMac (${naive.length} naive, ${sent.length} sentence, ${els.length} element chunks)`);
  const sn = searcher(naive),
    ss = searcher(sent),
    se = searcher(els);
  score("1 naive 1000-char", q, (x) => sn(x.question).slice(0, FINAL));
  score("2 UC1 recipe (sentence chunks)", q, (x) => ss(x.question).slice(0, FINAL));
  score("4 element chunks (tables, prose groups, endnotes)", q, (x) => se(x.question).slice(0, FINAL));
}
