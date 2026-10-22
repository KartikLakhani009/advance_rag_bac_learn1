import fs from "node:fs";
import path from "node:path";
import { withEndnotes } from "@rag/core/src/chunking/elements.js";
import { AssetWriter } from "@rag/core/src/assets/manifest.js";
import { PROCESSED_DIR } from "@rag/core/src/cache.js";
import { parseCli, runCli } from "@rag/core/src/cli.js";
import { createLogger } from "@rag/core/src/logger.js";
import { SearchIndex } from "@rag/core/src/retrieve/searcher.js";
import { linkPhotos, syncAssetIds } from "@rag/core/src/usecase/assets.js";
import { createIngestContext } from "@rag/core/src/usecase/kit.js";
import { buildVisionChunks } from "@rag/core/src/usecase/vision-chunks.js";
import { createGemini, loadVisionPages } from "@rag/core/src/vision.js";
import { buildElementChunkSet, buildNaive, buildSentenceRecipe, loadUc3, UC, visionNotesToMarkers } from "./chunks.js";

const log = createLogger("uc3:ingest");

runCli(async () => {
  const cli = parseCli();
  const { env, chroma, embedder } = await createIngestContext({ naive: cli.naive });

  log.info("extracting text, rebuilding tables, parsing endnotes");
  const u = loadUc3();
  log.info(`endnotes parsed: ${u.endnotes.size}; tables rebuilt: ${[...u.tables.values()].flat().length}`);

  if (cli.naive) {
    await SearchIndex.build(chroma, UC, "naive", buildNaive(u), embedder);
    return;
  }

  await SearchIndex.build(
    chroma,
    UC,
    "sentence",
    buildSentenceRecipe(u).map((c) => withEndnotes(c, u.endnotes)),
    embedder,
  );
  const { chunks: elements, rows } = buildElementChunkSet(u);
  log.info(`elements: ${elements.length} chunks (${elements.filter((c) => c.kind === "table").length} tables), ${rows.length} table rows`);
  await SearchIndex.build(chroma, UC, "elements", elements, embedder);

  const config = loadVisionPages(path.join(import.meta.dirname, "..", "vision-pages.json"), u.doc.pages.length);
  const assets = new AssetWriter(UC);
  const visionRaw = await buildVisionChunks({
    uc: UC,
    doc: u.doc,
    config,
    client: createGemini(env),
    model: env.GEMINI_MODEL_VISION!,
    assets,
    kind: "vision",
  });
  const vision = visionRaw.map((c) => withEndnotes({ ...c, text: visionNotesToMarkers(c.text) }, u.endnotes));
  const tables = elements.filter((c) => c.kind === "table");
  const final = [...elements, ...vision];
  // small-to-big variant: search prose + table ROWS + vision; the LLM reads the whole table (parent) with its notes
  const rowsVariant = [...elements.filter((c) => c.kind !== "table"), ...rows, ...vision];

  const photos = linkPhotos(assets, u.doc, final, { prefix: UC });
  syncAssetIds(assets, final, rows);
  assets.write();
  fs.mkdirSync(path.join(PROCESSED_DIR, UC), { recursive: true });
  fs.writeFileSync(path.join(PROCESSED_DIR, UC, "parents.json"), JSON.stringify(tables));
  log.info(`vision: ${vision.length} chunks; assets: ${assets.assets.length} saved (${photos.decorative} decorative photos not linked)`);

  await SearchIndex.build(chroma, UC, "final", final, embedder);
  await SearchIndex.build(chroma, UC, "rows", rowsVariant, embedder);
});
