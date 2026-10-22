import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { UserError } from "./errors.js";

/** Repo root, independent of the directory a script is launched from. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const boolish = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim().toLowerCase()))
  .pipe(z.enum(["true", "false"]).optional())
  .transform((v) => (v === undefined ? undefined : v === "true"));

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optStr = z.preprocess(blankToUndef, z.string().optional());
const num = (def: number) => z.preprocess(blankToUndef, z.coerce.number().positive().default(def));

export const EnvSchema = z.object({
  APP_ENV: z.preprocess(blankToUndef, z.enum(["development", "production"]).default("development")),
  GROQ_API_KEY: optStr,
  GROQ_MODEL_FAST: z.preprocess(blankToUndef, z.string().default("openai/gpt-oss-20b")),
  GROQ_MODEL_ANSWER: z.preprocess(blankToUndef, z.string().default("openai/gpt-oss-20b")),
  GROQ_MODEL_ANSWER_UC1: optStr,
  GROQ_MODEL_ANSWER_UC2: optStr,
  GROQ_MODEL_ANSWER_UC3: optStr,
  GROQ_RPM: num(30),
  GEMINI_API_KEY: optStr,
  GEMINI_MODEL_VISION: optStr,
  GEMINI_RPM: num(10),
  VOYAGE_API_KEY: optStr,
  VOYAGE_EMBED_MODEL: z.preprocess(blankToUndef, z.string().default("voyage-4-lite")),
  VOYAGE_RERANK_MODEL: z.preprocess(blankToUndef, z.string().default("rerank-2.5-lite")),
  VOYAGE_RPM: num(3),
  VOYAGE_TPM: num(10000),
  CHROMA_URL: z.preprocess(blankToUndef, z.string().url().default("http://localhost:8000")),
  SHORTLIST_K: num(20),
  FINAL_K: num(5),
  RRF_K: num(2),
  RERANK_ENABLED: boolish,
  /** UC3 index variant: "final" (flat, default) or "rows" (small-to-big experiment) */
  UC3_VARIANT: z.preprocess(blankToUndef, z.enum(["final", "rows"]).default("final")),
  MAX_RETRIES: z.preprocess(blankToUndef, z.coerce.number().int().min(0).default(5)),
  LOG_LEVEL: z.preprocess(blankToUndef, z.enum(["debug", "info", "warn", "error"]).default("info")),
});

export type Env = z.infer<typeof EnvSchema>;
export type UseCaseId = "uc1" | "uc2" | "uc3";
export type EnvKey = keyof Env;

/**
 * Parse and validate process.env. `require` lists keys that must be set for the calling command;
 * the error names every missing/invalid key at once.
 */
export function loadConfig(opts: { require?: EnvKey[]; env?: NodeJS.ProcessEnv } = {}): Env {
  const source = opts.env ?? process.env;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new UserError(`Invalid environment: ${bad}. Check your .env against .env.example.`);
  }
  const env = parsed.data;
  const missing = (opts.require ?? []).filter((k) => env[k] === undefined || env[k] === "");
  if (missing.length) {
    throw new UserError(`Missing required environment variable(s): ${missing.join(", ")}. Set them in .env (see .env.example).`);
  }
  return env;
}

export interface RerankDecision {
  enabled: boolean;
  reason: string;
}

/**
 * Rerank mode resolution (spec section 13):
 * CLI flag → RERANK_ENABLED → APP_ENV default (dev off, prod on) → use-case override (UC3 always off).
 */
export function resolveRerank(args: {
  cliFlag?: boolean;
  env: Pick<Env, "RERANK_ENABLED" | "APP_ENV">;
  useCaseOverride?: boolean;
}): RerankDecision {
  if (args.useCaseOverride === false) return { enabled: false, reason: "disabled for this use case" };
  if (args.cliFlag !== undefined) return { enabled: args.cliFlag, reason: args.cliFlag ? "--rerank" : "--no-rerank" };
  if (args.env.RERANK_ENABLED !== undefined)
    return { enabled: args.env.RERANK_ENABLED, reason: `RERANK_ENABLED=${args.env.RERANK_ENABLED}` };
  const prod = args.env.APP_ENV === "production";
  return { enabled: prod, reason: prod ? "production" : "development" };
}

export function rerankLabel(d: RerankDecision, model: string): string {
  return d.enabled ? `Rerank: ON (Voyage ${model})` : `Rerank: OFF (${d.reason})`;
}

export const RAW_DIR = path.join(ROOT, "data", "raw");
export const ASSETS_DIR = path.join(ROOT, "data", "assets");
export const REPORTS_DIR = path.join(ROOT, "reports");

/** Answer model for a use case: its own `GROQ_MODEL_ANSWER_UCn` (escalation) or the shared default. */
export function answerModelFor(env: Env, uc: UseCaseId): string {
  const perUseCase = { uc1: env.GROQ_MODEL_ANSWER_UC1, uc2: env.GROQ_MODEL_ANSWER_UC2, uc3: env.GROQ_MODEL_ANSWER_UC3 }[uc];
  return perUseCase ?? env.GROQ_MODEL_ANSWER;
}
