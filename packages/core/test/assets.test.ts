import { describe, expect, it } from "vitest";
import { assetsForChunks, linkAssetToNearestChunk } from "../src/assets/manifest.js";
import { syncAssetIds } from "../src/usecase/assets.js";
import type { Asset, Chunk } from "../src/schemas.js";
import type { AssetWriter } from "../src/assets/manifest.js";

const chunk = (id: string, page: number, extra: Partial<Chunk> = {}): Chunk => ({
  id,
  kind: "text",
  text: id,
  page,
  pageEnd: page,
  printedPage: String(page),
  printedPageEnd: String(page),
  assetIds: [],
  ...extra,
});
const asset = (id: string, page: number, extra: Partial<Asset> = {}): Asset => ({
  id,
  type: "photo",
  file: `images/${id}.png`,
  page,
  printedPage: String(page),
  caption: "",
  decorative: false,
  sha256: "x",
  chunkIds: [],
  ...extra,
});

describe("asset linking", () => {
  it("links a captioned photo to the nearest prose chunk, never a decorative one", () => {
    const chunks = [chunk("p1", 1), chunk("p5", 5), chunk("v5", 5, { kind: "vision" })];
    const a = asset("a", 4);
    linkAssetToNearestChunk(a, chunks);
    expect(a.chunkIds).toEqual(["p5"]);
    const d = asset("d", 4, { decorative: true });
    linkAssetToNearestChunk(d, chunks);
    expect(d.chunkIds).toEqual([]);
  });
  it("syncs links onto chunk.assetIds without duplicates", () => {
    const c = chunk("c", 2, { assetIds: ["a"] });
    const writer = { assets: [asset("a", 2, { chunkIds: ["c"] }), asset("b", 2, { chunkIds: ["c"] }), asset("z", 9)] } as AssetWriter;
    syncAssetIds(writer, [c]);
    expect(c.assetIds).toEqual(["a", "b"]);
  });
  it("returns at most 4 non-decorative assets linked to the cited chunks", () => {
    const manifest = {
      assets: [1, 2, 3, 4, 5]
        .map((n) => asset(`a${n}`, 1, { chunkIds: ["c"] }))
        .concat(asset("dec", 1, { chunkIds: ["c"], decorative: true })),
    };
    expect(assetsForChunks(manifest, ["c"]).map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4"]);
  });
});
