import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeMetrics, firstHitRank, isHit } from "../src/eval/metrics.js";
import { RateLimiter } from "../src/ratelimit.js";
import { withRetry } from "../src/retry.js";
import { loadVisionPages } from "../src/vision.js";
import { extractJson } from "../src/llm.js";
import { hashOf } from "../src/cache.js";

describe("metrics", () => {
  const q = { goldPages: [96], evidence: "6.3 percent" };
  it("a hit needs page overlap and the evidence string", () => {
    expect(isHit({ page: 96, pageEnd: 96, text: "soften to 6.3 percent in 2026" }, q)).toBe(true);
    expect(isHit({ page: 95, pageEnd: 96, text: "growth of 6.3  percent" }, q)).toBe(true);
    expect(isHit({ page: 50, pageEnd: 50, text: "6.3 percent" }, q)).toBe(false);
    expect(isHit({ page: 96, pageEnd: 96, text: "nothing relevant" }, q)).toBe(false);
  });
  it("hit@k and MRR", () => {
    const m = computeMetrics([1, 3, 0, 5]);
    expect(m.hit1).toBe(0.25);
    expect(m.hit3).toBe(0.5);
    expect(m.hit5).toBe(0.75);
    expect(m.mrr).toBeCloseTo((1 + 1 / 3 + 0 + 1 / 5) / 4);
    expect(
      firstHitRank(
        [
          { page: 1, pageEnd: 1, text: "x" },
          { page: 96, pageEnd: 96, text: "6.3 percent" },
        ],
        q,
      ),
    ).toBe(2);
  });
});

describe("rate limiter", () => {
  it("lets RPM calls through then waits for the window", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const rl = new RateLimiter(
      2,
      undefined,
      () => t,
      async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    );
    await rl.acquire();
    await rl.acquire();
    expect(sleeps).toEqual([]);
    await rl.acquire();
    expect(sleeps.length).toBeGreaterThan(0);
    expect(t).toBeGreaterThanOrEqual(60_000);
  });
  it("enforces tokens per minute", async () => {
    let t = 0;
    const rl = new RateLimiter(
      100,
      1000,
      () => t,
      async (ms) => {
        t += ms;
      },
    );
    await rl.acquire(800);
    await rl.acquire(800);
    expect(t).toBeGreaterThanOrEqual(60_000);
  });
});

describe("retry", () => {
  it("retries retryable errors with backoff, then succeeds", async () => {
    let n = 0;
    const delays: number[] = [];
    const v = await withRetry(
      async () => {
        if (++n < 3) throw Object.assign(new Error("429"), { status: 429 });
        return "ok";
      },
      {
        maxRetries: 5,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );
    expect(v).toBe("ok");
    expect(delays).toHaveLength(2);
    expect(delays[1]!).toBeGreaterThan(delays[0]!);
  });
  it("does not retry other errors", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw Object.assign(new Error("bad request"), { status: 400 });
        },
        { maxRetries: 5, sleep: async () => {} },
      ),
    ).rejects.toThrow("bad request");
    expect(n).toBe(1);
  });
});

describe("vision pages config", () => {
  const write = (o: unknown) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vp-")), "vision-pages.json");
    fs.writeFileSync(f, JSON.stringify(o));
    return f;
  };
  it("accepts a valid file", () => {
    expect(loadVisionPages(write({ pages: [{ page: 2, saveAsset: true }] }), 12).pages).toHaveLength(1);
  });
  it("fails clearly on out-of-range pages", () => {
    expect(() => loadVisionPages(write({ pages: [{ page: 13, saveAsset: false }] }), 12)).toThrow(/page\(s\) 13 .* only 12 pages/);
  });
  it("fails on schema errors and duplicates", () => {
    expect(() => loadVisionPages(write({ pages: [{ page: "x" }] }), 12)).toThrow(/invalid/);
    expect(() =>
      loadVisionPages(
        write({
          pages: [
            { page: 2, saveAsset: false },
            { page: 2, saveAsset: true },
          ],
        }),
        12,
      ),
    ).toThrow(/more than once/);
  });
  it("the three shipped configs are valid for their documents", () => {
    for (const [uc, n] of [
      ["uc1-gpo", 82],
      ["uc2-gep", 200],
      ["uc3-imac", 12],
    ] as const) {
      const f = path.join(process.cwd(), "usecases", uc, "vision-pages.json");
      expect(loadVisionPages(f, n).pages.length).toBeGreaterThan(0);
    }
  });
});

describe("misc", () => {
  it("extracts JSON from noisy model output", () => {
    expect(extractJson('Sure! ```json\n{"a": {"b": "}"}, "c": 1}\n``` done')).toEqual({ a: { b: "}" }, c: 1 });
    expect(() => extractJson("no json")).toThrow();
  });
  it("hashOf ignores key order", () => {
    expect(hashOf({ a: 1, b: { c: 2, d: 3 } })).toBe(hashOf({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

import { checkAnswer } from "../src/eval/metrics.js";
describe("automatic answer checks", () => {
  const q = { answerContains: ["346", "45%", "<1%|less than 1"], answerExcludes: ["156", "173"] };
  it("passes when required fragments are present, ignoring spacing and hyphen style", () => {
    expect(checkAnswer("Total 346 kg; product use 45 % and end-of-life <1 %.", q).ok).toBe(true);
    expect(checkAnswer("It is 346 kg, 45% product use, less than 1% end of life", q).ok).toBe(true);
  });
  it("fails on missing or forbidden fragments", () => {
    const miss = checkAnswer("346 kg and 45%", q);
    expect(miss.ok).toBe(false);
    expect(miss.missing).toEqual(["<1%|less than 1"]);
    const bad = checkAnswer("346 kg, 45% (about 156 kg), <1%", q);
    expect(bad.forbidden).toEqual(["156"]);
  });
  it("normalises non-breaking hyphens and units", () => {
    expect(checkAnswer("business‑as‑usual, 0.57 W", { answerContains: ["business-as-usual", "0.57w"], answerExcludes: [] }).ok).toBe(true);
  });
});
