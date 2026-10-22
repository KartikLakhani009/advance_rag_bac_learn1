import type { ChromaClient, Collection } from "chromadb";
import fs from "node:fs";
import path from "node:path";
import type MiniSearch from "minisearch";
import { PROCESSED_DIR } from "../cache.js";
import type { Embedder } from "../embeddings.js";
import { UserError } from "../errors.js";
import { Chunk } from "../schemas.js";
import { buildBm25, bm25Search, loadBm25, saveBm25, type Ranked } from "./bm25.js";
import { denseSearch, indexDense, openCollection } from "./dense.js";
import type { Filter } from "./filters.js";
import { rrfFuse } from "./hybrid.js";

export type SearchMode = "dense" | "bm25" | "hybrid";

/** One searchable chunk set: a Chroma collection + a persisted MiniSearch index + the chunk store. */
export class SearchIndex {
  readonly byId: Map<string, Chunk>;

  private constructor(
    readonly uc: string,
    readonly variant: string,
    readonly chunks: Chunk[],
    readonly bm25: MiniSearch,
    readonly col: Collection,
    readonly embedder: Embedder,
  ) {
    this.byId = new Map(chunks.map((c) => [c.id, c]));
  }

  static dir(uc: string, variant: string): string {
    return path.join(PROCESSED_DIR, uc, "index", variant);
  }

  static collectionName(uc: string, variant: string): string {
    return `${uc}__${variant}`.replace(/[^\w-]/g, "_");
  }

  /** Build all three stores from chunks. Embeddings come from the disk cache when the text was seen before. */
  static async build(client: ChromaClient, uc: string, variant: string, chunks: Chunk[], embedder: Embedder): Promise<SearchIndex> {
    const dir = SearchIndex.dir(uc, variant);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "chunks.json"), JSON.stringify(chunks));
    const bm25 = buildBm25(chunks);
    saveBm25(bm25, path.join(dir, "bm25.json"));
    const col = await indexDense(client, SearchIndex.collectionName(uc, variant), chunks, embedder);
    return new SearchIndex(uc, variant, chunks, bm25, col, embedder);
  }

  static async open(client: ChromaClient, uc: string, variant: string, embedder: Embedder): Promise<SearchIndex> {
    const dir = SearchIndex.dir(uc, variant);
    const file = path.join(dir, "chunks.json");
    if (!fs.existsSync(file))
      throw new UserError(
        `No index "${variant}" for ${uc}. Run ingest first (npm run ${uc}:ingest${variant === "naive" ? " -- --naive" : ""}).`,
      );
    const chunks = (JSON.parse(fs.readFileSync(file, "utf8")) as unknown[]).map((c) => Chunk.parse(c));
    const bm25 = loadBm25(path.join(dir, "bm25.json"));
    const col = await openCollection(client, SearchIndex.collectionName(uc, variant));
    return new SearchIndex(uc, variant, chunks, bm25, col, embedder);
  }

  dense(query: string, k: number, filter?: Filter): Promise<Ranked[]> {
    return denseSearch(this.col, this.embedder, query, k, filter);
  }

  keyword(query: string, k: number, filter?: Filter): Ranked[] {
    return bm25Search(this.bm25, query, k, filter);
  }

  /** Shortlist k from dense and from BM25, fused with RRF. */
  async hybrid(query: string, k: number, rrfK: number, filter?: Filter): Promise<Ranked[]> {
    const [d, b] = [await this.dense(query, k, filter), this.keyword(query, k, filter)];
    return rrfFuse([d, b], rrfK);
  }

  async search(mode: SearchMode, query: string, k: number, rrfK: number, filter?: Filter): Promise<Ranked[]> {
    if (mode === "dense") return this.dense(query, k, filter);
    if (mode === "bm25") return this.keyword(query, k, filter);
    return this.hybrid(query, k, rrfK, filter);
  }

  /** The top `k` ranked hits as chunks. */
  chunksOf(ranked: Ranked[], k = ranked.length): Chunk[] {
    return ranked.slice(0, k).map((r) => this.chunk(r.id));
  }

  chunk(id: string): Chunk {
    const c = this.byId.get(id);
    if (!c) throw new Error(`unknown chunk ${id}`);
    return c;
  }
}
