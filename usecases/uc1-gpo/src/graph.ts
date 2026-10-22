import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { generateAnswer, type GeneratedAnswer } from "@rag/core/src/answer.js";
import type { Ranked } from "@rag/core/src/retrieve/bm25.js";
import type { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import type { Chunk, QueryResult } from "@rag/core/src/schemas.js";
import type { UseCaseApp } from "@rag/core/src/usecase/app.js";
import { toAskOutput } from "@rag/core/src/usecase/ask-output.js";
import { rerankStage, type Runtime } from "@rag/core/src/usecase/kit.js";

type Trace = QueryResult["trace"][number];

const State = Annotation.Root({
  question: Annotation<string>(),
  shortlist: Annotation<Ranked[]>(),
  final: Annotation<Ranked[]>(),
  rerankUsed: Annotation<boolean>(),
  rerankError: Annotation<string | undefined>(),
  passages: Annotation<Chunk[]>(),
  generated: Annotation<GeneratedAnswer>(),
  trace: Annotation<Trace[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

export interface Uc1Options {
  /** naive = 1000-char chunks, dense only (the baseline) */
  naive: boolean;
  /** index variant to query; defaults to naive|final */
  variant?: string;
}

/**
 * UC1 graph: retrieve (hybrid) → rerank (if enabled) → generate.
 * No query understanding: the questions are plain and the document has no region/chapter structure to filter on.
 */
export function createUc1App(rt: Runtime, index: SearchIndex, opts: Uc1Options): UseCaseApp {
  const mode = opts.naive ? "dense" : "hybrid";
  const k = rt.env.SHORTLIST_K;

  const graph = new StateGraph(State)
    .addNode("retrieve", async (s) => {
      const shortlist = await index.search(mode, s.question, k, rt.env.RRF_K);
      return {
        shortlist,
        trace: [
          {
            stage: "Retrieve",
            note: `${mode === "hybrid" ? "Hybrid (dense + BM25, RRF)" : "Dense"} search over ${index.chunks.length} ${opts.naive ? "naive 1000-char" : "sentence/vision"} chunks: shortlist of ${shortlist.length}`,
          } as Trace,
        ],
      };
    })
    .addNode("rerank", async (s) => {
      const r = await rerankStage(rt, index, s.question, s.shortlist, rt.env.FINAL_K);
      return { final: r.ranked, rerankUsed: r.used, rerankError: r.error, trace: [{ stage: "Post-process", note: r.note } as Trace] };
    })
    .addNode("generate", async (s) => {
      const passages = s.final.map((r) => index.chunk(r.id));
      const generated = await generateAnswer(rt.answerLlm(), s.question, passages);
      return {
        passages,
        generated,
        trace: [{ stage: "Generate", note: `${passages.length} numbered passages → ${generated.status}` } as Trace],
      };
    })
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "rerank")
    .addEdge("rerank", "generate")
    .addEdge("generate", END)
    .compile();

  return {
    async ask(question) {
      const state = await graph.invoke({ question });
      return toAskOutput({ uc: "uc1", state, index, rerankModel: rt.rerankModel });
    },
  };
}
