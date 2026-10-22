import fs from "node:fs";
import path from "node:path";
import { AssetWriter } from "@rag/core/src/assets/manifest.js";
import { PROCESSED_DIR } from "@rag/core/src/cache.js";
import { parseCli, runCli } from "@rag/core/src/cli.js";
import { createLogger } from "@rag/core/src/logger.js";
import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { linkPhotos, syncAssetIds } from "@rag/core/src/usecase/assets.js";
import { createIngestContext } from "@rag/core/src/usecase/kit.js";
import { buildVisionChunks } from "@rag/core/src/usecase/vision-chunks.js";
import { createGemini, loadVisionPages } from "@rag/core/src/vision.js";
import { buildHier, buildNaive, buildNoiseSummary, loadUc2, stripHeadingPath, tableMeta, UC } from "./chunks.js";

const log = createLogger("uc2:ingest");

runCli(async () => {
  const cli = parseCli();
  const { env, chroma, embedder } = await createIngestContext({ naive: cli.naive });

  log.info("extracting, repairing and structuring text from fonts");
  const u = loadUc2();

  if (cli.naive) {
    const chunks = buildNaive(u);
    log.info(`naive: ${chunks.length} chunks, ${chunks.filter((c) => c.endsOnSentence).length} end on a sentence boundary`);
    await SearchIndex.build(chroma, UC, "naive", chunks, embedder);
    return;
  }

  const { parents, children } = buildHier(u);
  log.info(`hierarchy: ${parents.length} parents, ${children.length} children; excluded as noise: ${JSON.stringify(buildNoiseSummary(u))}`);
  fs.mkdirSync(path.join(PROCESSED_DIR, UC), { recursive: true });
  fs.writeFileSync(path.join(PROCESSED_DIR, UC, "parents.json"), JSON.stringify(parents));

  // ladder step 2: section-aware chunks with nothing but their text embedded; steps 3-6: heading path embedded
  await SearchIndex.build(chroma, UC, "sections", stripHeadingPath(children), embedder);
  await SearchIndex.build(chroma, UC, "children", children, embedder);

  const config = loadVisionPages(path.join(import.meta.dirname, "..", "vision-pages.json"), u.doc.pages.length);
  const assets = new AssetWriter(UC);
  const tables = await buildVisionChunks({
    uc: UC,
    doc: u.doc,
    config,
    client: createGemini(env),
    model: env.GEMINI_MODEL_VISION!,
    assets,
    kind: "table",
    headingFor: (page) => tableMeta(u, page).headingPath,
    metaFor: (page) => {
      const { chapter, chapterTitle, region } = tableMeta(u, page);
      return { chapter, chapterTitle, region };
    },
  });
  log.info(`vision: ${tables.length} table chunks (each its own parent) from ${config.pages.length} listed pages`);
  const final = [...children, ...tables];

  linkPhotos(assets, u.doc, final, { prefix: UC });
  syncAssetIds(assets, final);
  assets.write();
  log.info(`assets: ${assets.assets.length} saved`);

  await SearchIndex.build(chroma, UC, "final", final, embedder);
});
