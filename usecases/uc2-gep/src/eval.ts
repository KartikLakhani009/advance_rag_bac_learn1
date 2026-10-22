import path from "node:path";
import type { LadderStep } from "@rag/core/src/eval/ladder.js";
import { swapChildrenForParents } from "@rag/core/src/retrieve/parents.js";
import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { runEvalCommand } from "@rag/core/src/usecase/commands.js";
import { rerankStage, type Runtime } from "@rag/core/src/usecase/kit.js";
import type { Chunk, EvalQuestion } from "@rag/core/src/schemas.js";
import { UC } from "./chunks.js";
import { createUc2App } from "./graph.js";
import { MIN_FILTER_HITS, searchFiltered } from "./search.js";
import { loadParents } from "./store.js";
import { understandWithLlm, understandWithRules, type Understood } from "./understand.js";

type Router = (q: EvalQuestion) => Understood | Promise<Understood>;

/** 1 naive … 5/5′ routing (rules / LLM) … 6 parents … 7 vision tables … 8 rerank (production / --rerank only). */
async function buildLadder(rt: Runtime, parents: Map<string, Chunk>): Promise<LadderStep[]> {
  const { SHORTLIST_K: k, RRF_K: rrfK, FINAL_K: finalK } = rt.env;
  const open = (variant: string) => SearchIndex.open(rt.chroma, UC, variant, rt.embedder);
  const [naive, sections, children, final] = [await open("naive"), await open("sections"), await open("children"), await open("final")];
  const llm = rt.fastLlm();
  const byRules: Router = (q) => understandWithRules(q.question);
  const byLlm: Router = (q) => understandWithLlm(llm, q.question);

  const routed = (index: SearchIndex, route: Router) => async (q: EvalQuestion) => {
    const u = await route(q);
    return index.chunksOf((await searchFiltered(index, "hybrid", u.search_query, u, k, rrfK)).shortlist, finalK);
  };
  const asParents =
    (index: SearchIndex, rerankOn: boolean) =>
    async (q: EvalQuestion): Promise<Chunk[]> => {
      const u = await byLlm(q);
      const { shortlist } = await searchFiltered(index, "hybrid", u.search_query, u, k, rrfK);
      const ranked = rerankOn ? (await rerankStage(rt, index, u.search_query, shortlist, finalK)).ranked : shortlist.slice(0, finalK);
      return swapChildrenForParents(index.chunksOf(ranked), parents, 3).passages;
    };
  const note = `steps 6–8 score larger units (≤3 parents), so they are not comparable with steps 1–5; fewer than ${MIN_FILTER_HITS} filtered hits falls back to the whole report`;

  return [
    { id: "1", label: "naive 1000-char chunks, dense", run: async (q) => naive.chunksOf(await naive.dense(q.question, k), finalK) },
    {
      id: "2",
      label: "section-aware chunks (dense, text only)",
      run: async (q) =>
        sections.chunksOf(await sections.dense(q.question, k, { excludeKinds: ["table_fragment", "front_matter", "references"] }), finalK),
    },
    { id: "3", label: "+ heading path embedded (dense)", run: async (q) => children.chunksOf(await children.dense(q.question, k), finalK) },
    {
      id: "4",
      label: "+ hybrid (dense + BM25, RRF)",
      run: async (q) => children.chunksOf(await children.hybrid(q.question, k, rrfK), finalK),
    },
    { id: "5", label: "+ routing (rules) with fallback", run: routed(children, byRules) },
    { id: "5′", label: "routing (LLM) with fallback", run: routed(children, byLlm) },
    { id: "6", label: "+ parents (LLM routing; scored on parent sections)", run: asParents(children, false), note },
    { id: "7", label: "+ vision table chunks (parents)", run: asParents(final, false), note: "scored on parent sections" },
    rt.rerank.enabled
      ? { id: "8", label: "+ rerank (Voyage), parents", run: asParents(final, true), note: "scored on parent sections" }
      : {
          id: "8",
          label: "+ rerank (Voyage), parents",
          skipped: `rerank is off (${rt.rerank.reason}); run with --rerank or APP_ENV=production`,
        },
  ];
}

runEvalCommand({
  uc: "uc2",
  title: "UC2 — Global Economic Prospects, June 2026",
  questionsFile: path.join(import.meta.dirname, "..", "eval", "questions.yaml"),
  async setup(rt, cli) {
    const parents = cli.naive ? new Map<string, Chunk>() : loadParents();
    const index = await SearchIndex.open(rt.chroma, UC, cli.naive ? "naive" : "final", rt.embedder);
    return {
      app: createUc2App(rt, index, { naive: cli.naive, parents }),
      ladder: cli.ladder ? await buildLadder(rt, parents) : undefined,
      scoreParents: !cli.naive,
      notes: ["Ladder steps 6–8 score larger units (up to 3 parent sections), so they are not directly comparable with steps 1–5."],
    };
  },
});
