import path from "node:path";
import type { LadderStep } from "@rag/core/src/eval/ladder.js";
import { swapChildrenForParents } from "@rag/core/src/retrieve/parents.js";
import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { runEvalCommand } from "@rag/core/src/usecase/commands.js";
import type { Runtime } from "@rag/core/src/usecase/kit.js";
import { UC } from "./chunks.js";
import { createUc3App } from "./graph.js";
import { loadTables } from "./store.js";

/** 1 naive … 4 elements + hybrid … 5 + vision … 6 small-to-big (table rows searched, whole table read). */
async function buildLadder(rt: Runtime): Promise<LadderStep[]> {
  const { SHORTLIST_K: k, RRF_K: rrfK, FINAL_K: finalK } = rt.env;
  const open = (variant: string) => SearchIndex.open(rt.chroma, UC, variant, rt.embedder);
  const [naive, sentence, elements, final, rows] = [
    await open("naive"),
    await open("sentence"),
    await open("elements"),
    await open("final"),
    await open("rows"),
  ];
  const tables = loadTables();
  return [
    { id: "1", label: "naive 1000-char chunks, dense", run: async (q) => naive.chunksOf(await naive.dense(q.question, k), finalK) },
    {
      id: "2",
      label: "UC1 recipe (sentence chunks, hybrid)",
      run: async (q) => sentence.chunksOf(await sentence.hybrid(q.question, k, rrfK), finalK),
    },
    { id: "3", label: "element chunks, dense", run: async (q) => elements.chunksOf(await elements.dense(q.question, k), finalK) },
    { id: "4", label: "element chunks, hybrid", run: async (q) => elements.chunksOf(await elements.hybrid(q.question, k, rrfK), finalK) },
    { id: "5", label: "elements + vision, hybrid", run: async (q) => final.chunksOf(await final.hybrid(q.question, k, rrfK), finalK) },
    {
      id: "6",
      label: "+ table rows searched, whole table (with notes) read — small-to-big",
      run: async (q) => swapChildrenForParents(rows.chunksOf(await rows.hybrid(q.question, k, rrfK), finalK), tables, finalK).passages,
      note: "scored on the passages the LLM reads (rows swapped for their tables)",
    },
  ];
}

runEvalCommand({
  uc: "uc3",
  useCaseRerank: false,
  title: "UC3 — Apple iMac Product Environmental Report (Oct 2024)",
  questionsFile: path.join(import.meta.dirname, "..", "eval", "questions.yaml"),
  async setup(rt, cli) {
    const variant = cli.naive ? "naive" : rt.env.UC3_VARIANT;
    const index = await SearchIndex.open(rt.chroma, UC, variant, rt.embedder);
    return {
      app: createUc3App(rt, index, { naive: cli.naive, parents: variant === "rows" ? loadTables() : undefined }),
      ladder: cli.ladder ? await buildLadder(rt) : undefined,
      scoreParents: variant === "rows",
      tag: cli.naive ? undefined : variant,
      rerankLabel: "Rerank: OFF (always off for UC3)",
      notes: ["Rerank is never used for UC3: the reference run showed a prose-trained reranker under-ranks table chunks on this document."],
    };
  },
});
