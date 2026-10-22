import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { generateAnswer, type GeneratedAnswer } from "@rag/core/src/answer.js";
import type { Ranked } from "@rag/core/src/retrieve/bm25.js";
import { swapChildrenForParents } from "@rag/core/src/retrieve/parents.js";
import type { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import type { Chunk, ParentChunk, QueryResult } from "@rag/core/src/schemas.js";
import type { UseCaseApp } from "@rag/core/src/usecase/app.js";
import { toAskOutput } from "@rag/core/src/usecase/ask-output.js";
import type { Runtime } from "@rag/core/src/usecase/kit.js";

type Trace = QueryResult["trace"][number];

const State = Annotation.Root({
  question: Annotation<string>(),
  shortlist: Annotation<Ranked[]>(),
  final: Annotation<Ranked[]>(),
  passages: Annotation<Chunk[]>(),
  generated: Annotation<GeneratedAnswer>(),
  trace: Annotation<Trace[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

export interface Uc3Options {
  naive: boolean;
  /** table chunks by id: when set, table_row children are swapped for their whole table (small-to-big) */
  parents?: Map<string, ParentChunk | Chunk>;
}

/**
 * UC3 graph: retrieve (hybrid) → generate. There is no rerank node on purpose: a prose-trained reranker under-ranks
 * table chunks on this document, so rerank is off in every environment (see docs/uc3-imac-understanding.md).
 */
export function createUc3App(rt: Runtime, index: SearchIndex, opts: Uc3Options): UseCaseApp {
  const mode = opts.naive ? "dense" : "hybrid";
  const { SHORTLIST_K: k, RRF_K: rrfK, FINAL_K: finalK } = rt.env;

  const graph = new StateGraph(State)
    .addNode("retrieve", async (s) => {
      const shortlist = await index.search(mode, s.question, k, rrfK);
      const final = shortlist.slice(0, finalK);
      return {
        shortlist,
        final,
        trace: [
          {
            stage: "Retrieve",
            note: `${mode === "hybrid" ? "Hybrid (dense + BM25, RRF)" : "Dense"} search over ${index.chunks.length} ${opts.naive ? "naive 1000-char" : "element/vision"} chunks: shortlist of ${shortlist.length}`,
          },
          {
            stage: "Post-process",
            note: `Rerank skipped (${rt.rerank.reason}; always off for UC3): kept the top ${final.length} in fused order`,
          },
        ] as Trace[],
      };
    })
    .addNode("generate", async (s) => {
      const children = s.final.map((r) => index.chunk(r.id));
      const swap = opts.parents ? swapChildrenForParents(children, opts.parents, finalK) : undefined;
      const passages = swap ? swap.passages : children;
      const generated = await generateAnswer(rt.answerLlm(), s.question, passages);
      const trace: Trace[] = [];
      if (swap)
        trace.push({
          stage: "Post-process",
          note: `Swapped ${swap.swapped} table-row hits for whole tables (deduped): ${passages.length} passages`,
        });
      trace.push({ stage: "Generate", note: `${passages.length} numbered passages → ${generated.status}` });
      return { passages, generated, trace };
    })
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate")
    .addEdge("generate", END)
    .compile();

  return {
    async ask(question) {
      const state = await graph.invoke({ question });
      return toAskOutput({ uc: "uc3", state, index, rerankModel: rt.rerankModel });
    },
  };
}
