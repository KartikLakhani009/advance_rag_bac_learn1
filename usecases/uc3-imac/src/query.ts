import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { runQueryCommand } from "@rag/core/src/usecase/commands.js";
import { UC } from "./chunks.js";
import { createUc3App } from "./graph.js";
import { loadTables } from "./store.js";

runQueryCommand({
  uc: "uc3",
  useCaseRerank: false,
  usage: 'Usage: npm run uc3:query -- "question" [--debug] [--naive] [--open]',
  rerankLabel: (_rt, cli) => ({
    label: "Rerank: OFF (always off for UC3: a prose-trained reranker under-ranks table chunks)",
    note: cli.rerank ? "--rerank ignored for UC3" : undefined,
  }),
  async setup(rt, cli) {
    const variant = cli.naive ? "naive" : rt.env.UC3_VARIANT;
    const index = await SearchIndex.open(rt.chroma, UC, variant, rt.embedder);
    return createUc3App(rt, index, { naive: cli.naive, parents: variant === "rows" ? loadTables() : undefined });
  },
});
