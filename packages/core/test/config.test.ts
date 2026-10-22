import { describe, expect, it } from "vitest";
import { loadConfig, rerankLabel, resolveRerank } from "../src/config.js";

describe("config", () => {
  it("applies defaults and validates", () => {
    const env = loadConfig({ env: {} });
    expect(env.APP_ENV).toBe("development");
    expect(env.VOYAGE_RPM).toBe(3);
    expect(env.RERANK_ENABLED).toBeUndefined();
    expect(env.RRF_K).toBe(2);
  });
  it("names every missing key at once", () => {
    expect(() => loadConfig({ env: {}, require: ["GROQ_API_KEY", "VOYAGE_API_KEY"] })).toThrow(/GROQ_API_KEY, VOYAGE_API_KEY/);
  });
  it("rejects invalid values", () => {
    expect(() => loadConfig({ env: { APP_ENV: "staging" } })).toThrow(/APP_ENV/);
    expect(() => loadConfig({ env: { RERANK_ENABLED: "maybe" } })).toThrow(/RERANK_ENABLED/);
  });
  it("treats blank values from .env.example as unset", () => {
    const env = loadConfig({ env: { RERANK_ENABLED: "", GEMINI_MODEL_VISION: "", VOYAGE_RPM: "" } });
    expect(env.RERANK_ENABLED).toBeUndefined();
    expect(env.GEMINI_MODEL_VISION).toBeUndefined();
    expect(env.VOYAGE_RPM).toBe(3);
  });
});

describe("rerank mode resolution: CLI flag → RERANK_ENABLED → APP_ENV → use-case override", () => {
  const dev = { APP_ENV: "development", RERANK_ENABLED: undefined } as const;
  const prod = { APP_ENV: "production", RERANK_ENABLED: undefined } as const;
  it("APP_ENV default: development off, production on", () => {
    expect(resolveRerank({ env: dev }).enabled).toBe(false);
    expect(resolveRerank({ env: prod }).enabled).toBe(true);
  });
  it("RERANK_ENABLED overrides APP_ENV", () => {
    expect(resolveRerank({ env: { APP_ENV: "development", RERANK_ENABLED: true } }).enabled).toBe(true);
    expect(resolveRerank({ env: { APP_ENV: "production", RERANK_ENABLED: false } }).enabled).toBe(false);
  });
  it("CLI flag overrides everything except the use-case override", () => {
    expect(resolveRerank({ cliFlag: true, env: dev }).enabled).toBe(true);
    expect(resolveRerank({ cliFlag: false, env: { APP_ENV: "production", RERANK_ENABLED: true } }).enabled).toBe(false);
  });
  it("UC3 is always off, even with --rerank in production", () => {
    expect(resolveRerank({ cliFlag: true, env: { APP_ENV: "production", RERANK_ENABLED: true }, useCaseOverride: false }).enabled).toBe(
      false,
    );
  });
  it("labels state the mode", () => {
    expect(rerankLabel(resolveRerank({ env: dev }), "rerank-2.5-lite")).toBe("Rerank: OFF (development)");
    expect(rerankLabel(resolveRerank({ env: prod }), "rerank-2.5-lite")).toBe("Rerank: ON (Voyage rerank-2.5-lite)");
  });
});
