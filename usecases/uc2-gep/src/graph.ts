import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { generateAnswer, type GeneratedAnswer } from "@rag/core/src/answer.js";
import type { Ranked } from "@rag/core/src/retrieve/bm25.js";
import { swapChildrenForParents } from "@rag/core/src/retrieve/parents.js";
import type { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import type { Chunk, ParentChunk, QueryResult } from "@rag/core/src/schemas.js";
import type { UseCaseApp } from "@rag/core/src/usecase/app.js";
import { toAskOutput } from "@rag/core/src/usecase/ask-output.js";
import { rerankStage, type Runtime } from "@rag/core/src/usecase/kit.js";
import { describeFilter, toFilter, type Routing } from "./regions.js";
import { MIN_FILTER_HITS, searchFiltered } from "./search.js";
import { understandWithLlm, understandWithRules, type Understood } from "./understand.js";

type Trace = QueryResult["trace"][number];

const State = Annotation.Root({
  question: Annotation<string>(),
  understood: Annotation<Understood>(),
  usedFilter: Annotation<boolean>(),
  shortlist: Annotation<Ranked[]>(),
  final: Annotation<Ranked[]>(),
  rerankUsed: Annotation<boolean>(),
  rerankError: Annotation<string | undefined>(),
  passages: Annotation<Chunk[]>(),
  generated: Annotation<GeneratedAnswer>(),
  trace: Annotation<Trace[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

export interface Uc2Options {
  naive: boolean;
  /** "llm" (default) or "rules": which router feeds the filter */
  routing?: "llm" | "rules";
  parents: Map<string, ParentChunk | Chunk>;
}

const NO_ROUTING: Routing = { region: null, chapter: null, executive_summary: false, box: false };

/**
 * UC2 graph: understandQuery → hybrid search inside the filter → (fewer than 3 hits → whole report, no filter)
 * → rerank (if enabled) → swap children for parents (dedupe, rank order, max 3) → generate.
 */
export function createUc2App(rt: Runtime, index: SearchIndex, opts: Uc2Options): UseCaseApp {
  const k = rt.env.SHORTLIST_K;
  const rrfK = rt.env.RRF_K;
  const mode = opts.naive ? "dense" : "hybrid";
  const routing = opts.naive ? undefined : (opts.routing ?? "llm");

  const graph = new StateGraph(State)
    .addNode("understand", async (s) => {
      if (!routing) {
        return {
          understood: { ...NO_ROUTING, search_query: s.question, source: "rules" as const },
          trace: [{ stage: "Query", note: "Naive baseline: no query understanding" } as Trace],
        };
      }
      const u = routing === "llm" ? await understandWithLlm(rt.fastLlm(), s.question) : understandWithRules(s.question);
      return {
        understood: u,
        trace: [
          {
            stage: "Query",
            note: `${routing === "llm" ? "LLM read the question" : "Rules read the question"}: ${describeFilter(u)}${u.search_query !== s.question ? `; rewritten: "${u.search_query}"` : ""}`,
          } as Trace,
        ],
      };
    })
    .addNode("search", async (s) => {
      const u = s.understood;
      const r = routing
        ? await searchFiltered(index, mode, u.search_query, u, k, rrfK)
        : { shortlist: await index.search(mode, u.search_query, k, rrfK), usedFilter: false, fellBack: false, hasConstraint: false };
      const trace: Trace[] = [
        {
          stage: "Retrieve",
          note: `${mode === "hybrid" ? "Hybrid" : "Dense"} search over ${index.chunks.length} ${opts.naive ? "naive" : "heading-tagged"} chunks${r.hasConstraint ? " inside the filter" : ""}: shortlist of ${r.shortlist.length}`,
        },
      ];
      if (r.fellBack)
        trace.push({
          stage: "Retrieve",
          note: `Fewer than ${MIN_FILTER_HITS} hits in the filter: searched the whole report instead (shortlist of ${r.shortlist.length})`,
        });
      return { shortlist: r.shortlist, usedFilter: r.usedFilter, trace };
    })
    .addNode("rerank", async (s) => {
      const r = await rerankStage(rt, index, s.understood.search_query, s.shortlist, rt.env.FINAL_K);
      return { final: r.ranked, rerankUsed: r.used, rerankError: r.error, trace: [{ stage: "Post-process", note: r.note } as Trace] };
    })
    .addNode("parents", async (s) => {
      const children = s.final.map((r) => index.chunk(r.id));
      if (opts.naive)
        return {
          passages: children.slice(0, 3),
          trace: [{ stage: "Post-process", note: "Naive baseline: top 3 chunks, no parent swap" } as Trace],
        };
      const swap = swapChildrenForParents(children, opts.parents, 3);
      return {
        passages: swap.passages,
        trace: [
          {
            stage: "Post-process",
            note: `Swapped for ${swap.passages.length} parent section${swap.passages.length === 1 ? "" : "s"} (${swap.swapped} children → parents, deduped)`,
          } as Trace,
        ],
      };
    })
    .addNode("generate", async (s) => {
      const generated = await generateAnswer(rt.answerLlm(), s.question, s.passages);
      return { generated, trace: [{ stage: "Generate", note: `${s.passages.length} numbered passages → ${generated.status}` } as Trace] };
    })
    .addEdge(START, "understand")
    .addEdge("understand", "search")
    .addEdge("search", "rerank")
    .addEdge("rerank", "parents")
    .addEdge("parents", "generate")
    .addEdge("generate", END)
    .compile();

  return {
    async ask(question) {
      const state = await graph.invoke({ question });
      return toAskOutput({
        uc: "uc2",
        state,
        index,
        rerankModel: rt.rerankModel,
        filters: routing && state.usedFilter ? (toFilter(state.understood) as Record<string, unknown>) : null,
        rewrittenQuery: state.understood.search_query,
      });
    },
  };
}
