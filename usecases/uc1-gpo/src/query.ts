import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { runQueryCommand } from "@rag/core/src/usecase/commands.js";
import { UC } from "./chunks.js";
import { createUc1App } from "./graph.js";

runQueryCommand({
  uc: "uc1",
  usage: 'Usage: npm run uc1:query -- "question" [--debug] [--naive] [--rerank | --no-rerank] [--open]',
  async setup(rt, cli) {
    const index = await SearchIndex.open(rt.chroma, UC, cli.naive ? "naive" : "final", rt.embedder);
    return createUc1App(rt, index, { naive: cli.naive });
  },
});
