import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildContext, citedPassages, generateAnswer, isRefusal, normaliseAnswer } from "../src/answer.js";
import { DiskCache } from "../src/cache.js";
import type { Llm } from "../src/llm.js";
import { REFUSAL } from "../src/prompts.js";
import type { Chunk } from "../src/schemas.js";

const chunk = (id: string, text: string, extra: Partial<Chunk> = {}): Chunk => ({
  id,
  kind: "body",
  text,
  page: 96,
  pageEnd: 97,
  printedPage: "74",
  printedPageEnd: "75",
  assetIds: [],
  ...extra,
});

const llmReplying = (text: string): Llm & { complete: ReturnType<typeof vi.fn> } =>
  ({ model: "test-model", complete: vi.fn(async () => ({ text, inputTokens: 1, outputTokens: 1 })) }) as never;
const tmpCache = () => new DiskCache("answers-test", fs.mkdtempSync(path.join(os.tmpdir(), "answers-")));

describe("answer normalisation", () => {
  it("turns fullwidth brackets into [n] and note mentions into (Note n)", () => {
    expect(normaliseAnswer("It is 0.57 W【1】 and 346 kg [2]. See [Note 10].")).toBe("It is 0.57 W[1] and 346 kg [2]. See (Note 10).");
  });
  it("drops think tags", () => {
    expect(normaliseAnswer("<think>hm</think>answer [1]")).toBe("hmanswer [1]");
  });
  it("detects the exact refusal phrase, quoted or not, but not a longer answer", () => {
    expect(isRefusal(REFUSAL)).toBe(true);
    expect(isRefusal(`"${REFUSAL}"`)).toBe(true);
    expect(isRefusal(`${REFUSAL} However, the report mentions many other things in great detail.`)).toBe(false);
  });
  it("lists cited passages that exist, once, in order", () => {
    expect(citedPassages("a [2] b [1][2] c [9] d [0]", 3)).toEqual([2, 1]);
  });
});

describe("generateAnswer", () => {
  const passages = [chunk("a", "Growth in SAR is 6.3 percent."), chunk("b", "Other text.", { headingPath: "Chapter 2 > South Asia" })];

  it("labels passages with printed pages and heading paths", () => {
    expect(buildContext(passages)).toBe(
      "[1] (p. 74–75)\nGrowth in SAR is 6.3 percent.\n\n[2] (p. 74–75, Chapter 2 > South Asia)\nOther text.",
    );
  });
  it("answers with citations", async () => {
    const r = await generateAnswer(llmReplying("6.3 percent【1】"), "q", passages, tmpCache());
    expect(r).toEqual({ answer: "6.3 percent[1]", status: "answered", citedNs: [1] });
  });
  it("returns the refusal without calling the LLM when there are no passages", async () => {
    const llm = llmReplying("x");
    expect((await generateAnswer(llm, "q", [], tmpCache())).status).toBe("not_found");
    expect(llm.complete).not.toHaveBeenCalled();
  });
  it("maps a refusal reply to the exact phrase", async () => {
    const r = await generateAnswer(llmReplying(`"${REFUSAL}"`), "q", passages, tmpCache());
    expect(r).toEqual({ answer: REFUSAL, status: "not_found", citedNs: [] });
  });
  it("never pays twice for the same question, context and model", async () => {
    const llm = llmReplying("6.3 percent [1]");
    const cache = tmpCache();
    await generateAnswer(llm, "q", passages, cache);
    await generateAnswer(llm, "q", passages, cache);
    expect(llm.complete).toHaveBeenCalledTimes(1);
    await generateAnswer(llm, "another question", passages, cache);
    await generateAnswer(llm, "q", [chunk("a", "different context")], cache);
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });
});
