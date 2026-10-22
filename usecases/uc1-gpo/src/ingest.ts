import path from "node:path";
import { AssetWriter } from "@rag/core/src/assets/manifest.js";
import { parseCli, runCli } from "@rag/core/src/cli.js";
import { createLogger } from "@rag/core/src/logger.js";
import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { linkPhotos, syncAssetIds } from "@rag/core/src/usecase/assets.js";
import { createIngestContext } from "@rag/core/src/usecase/kit.js";
import { buildVisionChunks } from "@rag/core/src/usecase/vision-chunks.js";
import { createGemini, loadVisionPages } from "@rag/core/src/vision.js";
import { buildNaive, buildSentence, loadUc1, UC } from "./chunks.js";

const log = createLogger("uc1:ingest");

runCli(async () => {
  const cli = parseCli();
  const { env, chroma, embedder } = await createIngestContext({ naive: cli.naive });

  log.info("extracting + repairing text");
  const u = loadUc1();

  if (cli.naive) {
    const chunks = buildNaive(u);
    log.info(`naive: ${chunks.length} chunks, ${chunks.filter((c) => c.endsOnSentence).length} end on a sentence boundary`);
    await SearchIndex.build(chroma, UC, "naive", chunks, embedder);
    return;
  }

  const sentence = buildSentence(u);
  const ends = sentence.filter((c) => c.endsOnSentence).length;
  log.info(`sentence: ${sentence.length} chunks, ${ends} (${Math.round((100 * ends) / sentence.length)}%) end on a sentence boundary`);
  await SearchIndex.build(chroma, UC, "sentence", sentence, embedder);

  const config = loadVisionPages(path.join(import.meta.dirname, "..", "vision-pages.json"), u.doc.pages.length);
  const assets = new AssetWriter(UC);
  const vision = await buildVisionChunks({
    uc: UC,
    doc: u.doc,
    config,
    client: createGemini(env),
    model: env.GEMINI_MODEL_VISION!,
    assets,
    kind: "vision",
  });
  log.info(`vision: ${vision.length} chunks from ${config.pages.length} listed pages`);
  const final = [...sentence, ...vision];

  const photos = linkPhotos(assets, u.doc, final, { prefix: UC, pageFilter: (p) => p >= 3 && p <= 25 });
  syncAssetIds(assets, final);
  assets.write();
  log.info(`assets: ${assets.assets.length} saved (${photos.linked} captioned photos linked, ${photos.decorative} decorative)`);

  await SearchIndex.build(chroma, UC, "final", final, embedder);
});
