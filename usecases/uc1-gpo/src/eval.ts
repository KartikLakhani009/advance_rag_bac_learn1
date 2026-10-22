import path from "node:path";
import type { LadderStep } from "@rag/core/src/eval/ladder.js";
import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { runEvalCommand } from "@rag/core/src/usecase/commands.js";
import { rerankStage, type Runtime } from "@rag/core/src/usecase/kit.js";
import { UC } from "./chunks.js";
import { createUc1App } from "./graph.js";

/** A naive, B sentence chunks, C + hybrid, D + vision, E + rerank (production / --rerank only). */
async function buildLadder(rt: Runtime): Promise<LadderStep[]> {
  const { SHORTLIST_K: k, RRF_K: rrfK, FINAL_K: finalK } = rt.env;
  const open = (variant: string) => SearchIndex.open(rt.chroma, UC, variant, rt.embedder);
  const [naive, sentence, final] = [await open("naive"), await open("sentence"), await open("final")];
  const rerankStep: LadderStep = rt.rerank.enabled
    ? {
        id: "E",
        label: "+ rerank (Voyage)",
        run: async (q) => {
          const fused = await final.hybrid(q.question, k, rrfK);
          return final.chunksOf((await rerankStage(rt, final, q.question, fused, finalK)).ranked);
        },
      }
    : { id: "E", label: "+ rerank (Voyage)", skipped: `rerank is off (${rt.rerank.reason}); run with --rerank or APP_ENV=production` };
  return [
    { id: "A", label: "naive 1000-char chunks, dense", run: async (q) => naive.chunksOf(await naive.dense(q.question, k), finalK) },
    { id: "B", label: "sentence chunks, dense", run: async (q) => sentence.chunksOf(await sentence.dense(q.question, k), finalK) },
    {
      id: "C",
      label: "+ hybrid (dense + BM25, RRF)",
      run: async (q) => sentence.chunksOf(await sentence.hybrid(q.question, k, rrfK), finalK),
    },
    { id: "D", label: "+ vision chunks", run: async (q) => final.chunksOf(await final.hybrid(q.question, k, rrfK), finalK) },
    rerankStep,
  ];
}

runEvalCommand({
  uc: "uc1",
  title: "UC1 — GPO Annual Report 2018",
  questionsFile: path.join(import.meta.dirname, "..", "eval", "questions.yaml"),
  async setup(rt, cli) {
    const index = await SearchIndex.open(rt.chroma, UC, cli.naive ? "naive" : "final", rt.embedder);
    return { app: createUc1App(rt, index, { naive: cli.naive }), ladder: cli.ladder ? await buildLadder(rt) : undefined };
  },
});
