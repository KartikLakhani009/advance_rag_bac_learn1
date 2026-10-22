import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DiskCache } from "../src/cache.js";
import type { VoyageLike } from "../src/embeddings.js";
import { fitCandidates, rerank } from "../src/retrieve/rerank.js";

const cands = [
  { id: "a", text: "alpha growth outlook" },
  { id: "b", text: "beta table fragment" },
  { id: "c", text: "gamma South Asia 6.3 percent" },
];
const tmpCache = () => new DiskCache("rerank-test", fs.mkdtempSync(path.join(os.tmpdir(), "rerank-")));
const noSleep = async () => {};

function mockClient(impl: VoyageLike["rerank"]): VoyageLike & { rerank: ReturnType<typeof vi.fn> } {
  return { embed: vi.fn(), rerank: vi.fn(impl) } as never;
}

describe("rerank (mocked Voyage client, no API calls)", () => {
  it("reorders candidates by relevance score", async () => {
    const client = mockClient(async () => ({
      data: [
        { index: 2, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.4 },
      ],
      usage: { totalTokens: 50 },
    }));
    const out = await rerank("south asia growth", cands, 2, { client, model: "rerank-2.5-lite", maxRetries: 0, cache: tmpCache() });
    expect(out.used).toBe(true);
    expect(out.ranked.map((r) => r.id)).toEqual(["c", "a"]);
    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ model: "rerank-2.5-lite", topK: 2, documents: cands.map((c) => c.text) }),
    );
  });

  it("caches by (query, sorted candidate ids, model): a repeat makes no API call", async () => {
    const client = mockClient(async () => ({ data: [{ index: 1, relevanceScore: 0.8 }], usage: {} }));
    const cache = tmpCache();
    const o = { client, model: "rerank-2.5-lite", maxRetries: 0, cache };
    await rerank("q", cands, 1, o);
    const again = await rerank("q", [...cands].reverse(), 1, o); // same ids, different order → same key
    expect(client.rerank).toHaveBeenCalledTimes(1);
    expect(again.fromCache).toBe(true);
    await rerank("q", cands, 1, { ...o, model: "rerank-2.5" }); // other model → new call
    await rerank("different query", cands, 1, o);
    expect(client.rerank).toHaveBeenCalledTimes(3);
  });

  it("falls back to fused order, never throws, when the API keeps failing", async () => {
    const client = mockClient(async () => {
      throw Object.assign(new Error("429 rate limit"), { status: 429 });
    });
    const out = await rerank("q", cands, 2, { client, model: "m", maxRetries: 2, retrySleep: noSleep, cache: tmpCache() });
    expect(out.used).toBe(false);
    expect(out.ranked.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out.error).toMatch(/429/);
    expect(client.rerank).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("falls back on an empty response and does not cache failures", async () => {
    const client = mockClient(async () => ({ data: [] }));
    const cache = tmpCache();
    const out = await rerank("q", cands, 2, { client, model: "m", maxRetries: 0, cache });
    expect(out.used).toBe(false);
    await rerank("q", cands, 2, { client, model: "m", maxRetries: 0, cache });
    expect(client.rerank).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an empty candidate list", async () => {
    const client = mockClient(async () => ({ data: [] }));
    expect((await rerank("q", [], 5, { client, model: "m", maxRetries: 0 })).ranked).toEqual([]);
    expect(client.rerank).not.toHaveBeenCalled();
  });
});

describe("rerank token budget", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, text: "growth outlook ".repeat(60) }));

  it("keeps only the best-ranked candidates that fit, but always at least one", () => {
    const fit = fitCandidates("south asia growth", many, 3000);
    expect(fit.length).toBeGreaterThan(0);
    expect(fit.length).toBeLessThan(many.length);
    expect(fit.map((c) => c.id)).toEqual(many.slice(0, fit.length).map((c) => c.id));
    expect(fitCandidates("q", many, 1)).toHaveLength(1);
    expect(fitCandidates("q", many, 1_000_000)).toHaveLength(many.length);
  });

  it("sends only the candidates that fit and reports how many", async () => {
    const client = mockClient(async () => ({ data: [{ index: 0, relevanceScore: 0.9 }], usage: {} }));
    const out = await rerank("south asia growth", many, 1, { client, model: "m", maxRetries: 0, cache: tmpCache(), maxTokens: 3000 });
    const sent = (client.rerank.mock.calls[0]![0] as { documents: string[] }).documents.length;
    expect(sent).toBeLessThan(many.length);
    expect(out.candidatesSent).toBe(sent);
    expect(out.candidatesTotal).toBe(40);
  });
});
