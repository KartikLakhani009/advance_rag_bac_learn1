import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCli, runCli } from "../src/cli.js";
import { answerModelFor, loadConfig } from "../src/config.js";
import { ChromaDownError, CHROMA_DOWN_MESSAGE, UserError } from "../src/errors.js";

describe("runCli", () => {
  afterEach(() => vi.restoreAllMocks());
  const run = async (main: () => Promise<void>) => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    runCli(main);
    await new Promise((r) => setTimeout(r, 10));
    return { exit, err };
  };
  it("prints only the message for an expected UserError and exits 1", async () => {
    const { exit, err } = await run(async () => {
      throw new ChromaDownError();
    });
    expect(err).toHaveBeenCalledWith(CHROMA_DOWN_MESSAGE);
    expect(exit).toHaveBeenCalledWith(1);
  });
  it("prints the full error for an unexpected failure", async () => {
    const boom = new Error("boom");
    const { exit, err } = await run(async () => {
      throw boom;
    });
    expect(err).toHaveBeenCalledWith(boom);
    expect(exit).toHaveBeenCalledWith(1);
  });
  it("does nothing on success", async () => {
    const { exit } = await run(async () => {});
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("parseCli", () => {
  it("reads flags and the question", () => {
    const a = parseCli(["what is x", "--debug", "--no-rerank", "--retrieval-only"]);
    expect(a).toMatchObject({ positionals: ["what is x"], debug: true, rerank: false, retrievalOnly: true, naive: false });
    expect(parseCli(["--rerank"]).rerank).toBe(true);
    expect(parseCli([]).rerank).toBeUndefined();
  });
  it("rejects contradictory flags with a UserError", () => {
    expect(() => parseCli(["--rerank", "--no-rerank"])).toThrow(UserError);
  });
});

describe("per-use-case models and variants (validated env)", () => {
  it("uses the shared answer model unless a use case overrides it", () => {
    const env = loadConfig({ env: { GROQ_MODEL_ANSWER_UC2: "openai/gpt-oss-120b" } });
    expect(answerModelFor(env, "uc1")).toBe("openai/gpt-oss-20b");
    expect(answerModelFor(env, "uc2")).toBe("openai/gpt-oss-120b");
  });
  it("validates UC3_VARIANT", () => {
    expect(loadConfig({ env: {} }).UC3_VARIANT).toBe("final");
    expect(loadConfig({ env: { UC3_VARIANT: "rows" } }).UC3_VARIANT).toBe("rows");
    expect(() => loadConfig({ env: { UC3_VARIANT: "flat" } })).toThrow(UserError);
  });
});
