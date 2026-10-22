import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR } from "../config.js";
import { sha256 } from "../cache.js";
import { Asset, AssetManifest, type Chunk } from "../schemas.js";

export const assetDir = (uc: string) => path.join(ASSETS_DIR, uc);

/** Collects assets during ingestion and writes images + manifest.json (relative POSIX paths only). */
export class AssetWriter {
  readonly assets: Asset[] = [];
  constructor(readonly uc: string) {
    fs.rmSync(path.join(assetDir(uc), "images"), { recursive: true, force: true });
    fs.mkdirSync(path.join(assetDir(uc), "images"), { recursive: true });
  }

  add(a: Omit<Asset, "file" | "sha256" | "chunkIds"> & { png: Uint8Array; name: string; chunkIds?: string[] }): Asset {
    const rel = path.posix.join("images", `${a.name}.png`);
    fs.writeFileSync(path.join(assetDir(this.uc), ...rel.split("/")), a.png);
    const { png: _png, name: _name, ...rest } = a;
    const asset: Asset = Asset.parse({ ...rest, file: rel, sha256: sha256(a.png), chunkIds: a.chunkIds ?? [] });
    this.assets.push(asset);
    return asset;
  }

  write(): void {
    fs.writeFileSync(path.join(assetDir(this.uc), "manifest.json"), JSON.stringify({ assets: this.assets }, null, 2));
  }
}

export function loadManifest(uc: string): AssetManifest {
  const f = path.join(assetDir(uc), "manifest.json");
  if (!fs.existsSync(f)) return { assets: [] };
  return AssetManifest.parse(JSON.parse(fs.readFileSync(f, "utf8")));
}

/** Link a captioned, non-decorative asset to the nearest prose chunk on its page (or the closest page). */
export function linkAssetToNearestChunk(asset: Asset, chunks: Chunk[]): void {
  if (asset.decorative) return;
  const prose = chunks.filter((c) => c.kind !== "vision" && c.kind !== "table");
  const same = prose.filter((c) => c.page <= asset.page && c.pageEnd >= asset.page);
  const pool = same.length ? same : prose;
  if (!pool.length) return;
  const best = pool.reduce((b, c) => (Math.abs(c.page - asset.page) < Math.abs(b.page - asset.page) ? c : b), pool[0]!);
  asset.chunkIds.push(best.id);
}

/** Assets whose chunkIds intersect the cited chunks (max 4, non-decorative, order preserved). */
export function assetsForChunks(manifest: AssetManifest, chunkIds: string[], limit = 4): Asset[] {
  const out: Asset[] = [];
  for (const id of chunkIds) {
    for (const a of manifest.assets) {
      if (!a.decorative && a.chunkIds.includes(id) && !out.includes(a)) out.push(a);
    }
  }
  return out.slice(0, limit);
}
