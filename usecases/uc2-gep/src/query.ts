import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { runQueryCommand } from "@rag/core/src/usecase/commands.js";
import { UC } from "./chunks.js";
import { createUc2App } from "./graph.js";
import { loadParents } from "./store.js";

runQueryCommand({
  uc: "uc2",
  usage: 'Usage: npm run uc2:query -- "question" [--debug] [--naive] [--rerank | --no-rerank] [--open]',
  async setup(rt, cli) {
    const index = await SearchIndex.open(rt.chroma, UC, cli.naive ? "naive" : "final", rt.embedder);
    return createUc2App(rt, index, { naive: cli.naive, parents: cli.naive ? new Map() : loadParents() });
  },
});
