import { ChromaClient, type Collection } from "chromadb";
import { ChromaDownError } from "../errors.js";
import type { Chunk } from "../schemas.js";
import type { Embedder } from "../embeddings.js";
import { createLogger } from "../logger.js";
import { embeddedText, type Ranked } from "./bm25.js";
import { toChromaWhere, type Filter } from "./filters.js";

const log = createLogger("chroma");

export function chromaClient(url: string): ChromaClient {
  const u = new URL(url);
  return new ChromaClient({
    host: u.hostname,
    port: Number(u.port || (u.protocol === "https:" ? 443 : 8000)),
    ssl: u.protocol === "https:",
  });
}

/** Every use-case script calls this first; unreachable Chroma raises the standard hint. */
export async function ensureChroma(url: string): Promise<ChromaClient> {
  const client = chromaClient(url);
  try {
    await client.heartbeat();
  } catch {
    throw new ChromaDownError();
  }
  return client;
}

/** Collections hold our own vectors, so no embedding function is attached (the typings want an explicit null). */
export function openCollection(client: ChromaClient, name: string): Promise<Collection> {
  return client.getCollection({ name, embeddingFunction: null as never });
}

function metadata(c: Chunk): Record<string, string | number | boolean> {
  const m: Record<string, string | number | boolean> = { kind: c.kind, page: c.page, pageEnd: c.pageEnd };
  if (c.region) m.region = c.region;
  if (c.chapter !== undefined) m.chapter = c.chapter;
  return m;
}

/** (Re)create a collection and load chunk embeddings (computed through the cached Embedder). */
export async function indexDense(client: ChromaClient, name: string, chunks: Chunk[], embedder: Embedder): Promise<Collection> {
  try {
    await client.deleteCollection({ name });
  } catch {
    /* not there yet */
  }
  const col = await client.getOrCreateCollection({ name, embeddingFunction: null, metadata: { "hnsw:space": "cosine" } });
  const vectors = await embedder.embedDocuments(chunks.map(embeddedText), (d, t) => log.info(`${name}: embedded ${d}/${t}`));
  const B = 200;
  for (let i = 0; i < chunks.length; i += B) {
    const slice = chunks.slice(i, i + B);
    await col.upsert({
      ids: slice.map((c) => c.id),
      embeddings: vectors.slice(i, i + B),
      metadatas: slice.map(metadata),
      documents: slice.map((c) => c.text),
    });
  }
  log.info(`${name}: ${chunks.length} chunks indexed`);
  return col;
}

export async function denseSearch(col: Collection, embedder: Embedder, query: string, k: number, filter?: Filter): Promise<Ranked[]> {
  const q = await embedder.embedQuery(query);
  const total = await col.count();
  if (total === 0) return [];
  const res = await col.query({ queryEmbeddings: [q], nResults: Math.min(k, total), where: toChromaWhere(filter), include: ["distances"] });
  const ids = res.ids[0] ?? [];
  const dist = res.distances?.[0] ?? [];
  return ids.map((id, i) => ({ id, score: 1 - (dist[i] ?? 1) }));
}
