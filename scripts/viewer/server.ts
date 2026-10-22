/**
 * Local viewer for what is stored in Chroma: collections, chunks (documents + metadata), a 2-D PCA map of the
 * stored embeddings, and the saved image assets. Read-only. `npm run viewer` → http://localhost:5173
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROCESSED_DIR } from "@rag/core/src/cache.js";
import { ASSETS_DIR, loadConfig } from "@rag/core/src/config.js";
import { chromaClient, openCollection } from "@rag/core/src/retrieve/dense.js";

const env = loadConfig();
const chroma = chromaClient(env.CHROMA_URL);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.VIEWER_PORT ?? 5173);

interface Row {
  id: string;
  document: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

async function readAll(name: string, withEmbeddings: boolean): Promise<Row[]> {
  const col = await openCollection(chroma, name);
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 200) {
    const r = await col.get({
      limit: 200,
      offset,
      include: withEmbeddings ? ["documents", "metadatas", "embeddings"] : ["documents", "metadatas"],
    });
    r.ids.forEach((id, i) =>
      rows.push({
        id,
        document: r.documents[i] ?? "",
        metadata: (r.metadatas[i] ?? {}) as Record<string, unknown>,
        embedding: withEmbeddings ? (r.embeddings?.[i] as number[] | undefined) : undefined,
      }),
    );
    if (r.ids.length < 200) break;
  }
  return rows;
}

/** Chunk fields Chroma does not store (heading path, printed pages, assets) live in the persisted chunk store. */
function chunkStore(name: string): Map<string, Record<string, unknown>> {
  const [uc, variant] = name.split("__");
  const f = path.join(PROCESSED_DIR, uc!, "index", variant!, "chunks.json");
  if (!fs.existsSync(f)) return new Map();
  return new Map((JSON.parse(fs.readFileSync(f, "utf8")) as Array<Record<string, unknown>>).map((c) => [String(c.id), c]));
}

/** PCA to 2-D by power iteration (pure JS, no dependencies). */
function pca2(vectors: number[][]): Array<[number, number]> {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0]!.length;
  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j]! += v[j]! / n;
  const X = vectors.map((v) => v.map((x, j) => x - mean[j]!));
  const axes: number[][] = [];
  for (let k = 0; k < 2; k++) {
    let w = Array.from({ length: d }, (_, j) => Math.sin(j * 12.9898 + k * 78.233));
    for (let it = 0; it < 60; it++) {
      const t = X.map((row) => row.reduce((s, x, j) => s + x * w[j]!, 0));
      const next = new Array<number>(d).fill(0);
      X.forEach((row, i) => {
        for (let j = 0; j < d; j++) next[j]! += row[j]! * t[i]!;
      });
      for (const a of axes) {
        const p = next.reduce((s, x, j) => s + x * a[j]!, 0);
        for (let j = 0; j < d; j++) next[j]! -= p * a[j]!;
      }
      const norm = Math.hypot(...next) || 1;
      w = next.map((x) => x / norm);
    }
    axes.push(w);
  }
  return X.map(
    (row) => [row.reduce((s, x, j) => s + x * axes[0]![j]!, 0), row.reduce((s, x, j) => s + x * axes[1]![j]!, 0)] as [number, number],
  );
}

/** Resolve `rel` inside `root`; undefined when it escapes the root (path traversal) or does not exist. */
function safeFile(root: string, rel: string): string | undefined {
  const file = path.resolve(root, rel);
  const inside = path.relative(root, file);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return undefined;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : undefined;
}

const json = (res: http.ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};

const MIME: Record<string, string> = { ".html": "text/html", ".png": "image/png", ".js": "text/javascript", ".css": "text/css" };

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/api/collections") {
        const cols = await chroma.listCollections();
        const out = [];
        for (const c of cols) out.push({ name: c.name, count: await (await openCollection(chroma, c.name)).count() });
        return json(
          res,
          out.sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      if (url.pathname === "/api/chunks") {
        const name = url.searchParams.get("collection")!;
        const store = chunkStore(name);
        const rows = await readAll(name, false);
        return json(
          res,
          rows.map((r) => ({ id: r.id, document: r.document, chroma: r.metadata, chunk: store.get(r.id) ?? null })),
        );
      }
      if (url.pathname === "/api/projection") {
        const rows = await readAll(url.searchParams.get("collection")!, true);
        const pts = pca2(rows.map((r) => r.embedding ?? []));
        return json(
          res,
          rows.map((r, i) => ({ id: r.id, x: pts[i]![0], y: pts[i]![1], metadata: r.metadata, dim: r.embedding?.length })),
        );
      }
      if (url.pathname.startsWith("/assets/")) {
        const f = safeFile(ASSETS_DIR, decodeURIComponent(url.pathname.slice("/assets/".length)));
        if (!f) return json(res, { error: "not found" }, 404);
        res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" });
        return res.end(fs.readFileSync(f));
      }
      if (url.pathname === "/api/manifest") {
        const f = safeFile(ASSETS_DIR, path.join(url.searchParams.get("uc") ?? "", "manifest.json"));
        return json(res, f ? JSON.parse(fs.readFileSync(f, "utf8")) : { assets: [] });
      }
      const file = safeFile(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
      if (!file) return json(res, { error: "not found" }, 404);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "text/plain" });
      res.end(fs.readFileSync(file));
    } catch (e) {
      json(res, { error: (e as Error).message }, 500);
    }
  })
  // loopback only: the viewer has no authentication and shows the full document text
  .listen(PORT, "127.0.0.1", () => console.log(`Chroma viewer: http://localhost:${PORT}  (Chroma at ${env.CHROMA_URL})`));
