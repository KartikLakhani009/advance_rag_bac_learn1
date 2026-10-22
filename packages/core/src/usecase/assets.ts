import { extractPhotos } from "../assets/extract.js";
import { linkAssetToNearestChunk, type AssetWriter } from "../assets/manifest.js";
import type { LoadedDoc } from "../pdf/document.js";
import type { Chunk } from "../schemas.js";

/**
 * Photos for one use case: embedded raster images are saved; captioned ones link to the nearest prose chunk in
 * `linkTargets`, decorative ones are saved but never linked.
 */
export function linkPhotos(
  assets: AssetWriter,
  doc: LoadedDoc,
  linkTargets: Chunk[],
  opts: { prefix: string; pageFilter?: (page: number) => boolean },
) {
  const photos = extractPhotos(assets, doc.pdf, doc.pages, opts);
  for (const photo of photos) linkAssetToNearestChunk(photo, linkTargets);
  return { photos, linked: photos.filter((p) => !p.decorative).length, decorative: photos.filter((p) => p.decorative).length };
}

/** Copy asset links onto the chunks they point at (`chunk.assetIds`), so a chunk knows its images. */
export function syncAssetIds(assets: AssetWriter, ...chunkLists: Chunk[][]): void {
  for (const chunks of chunkLists) {
    for (const c of chunks) {
      const ids = assets.assets.filter((a) => a.chunkIds.includes(c.id)).map((a) => a.id);
      c.assetIds = [...new Set([...c.assetIds, ...ids])];
    }
  }
}
