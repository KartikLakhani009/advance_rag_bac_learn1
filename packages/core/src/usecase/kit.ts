import type { ChromaClient } from "chromadb";
import {
  answerModelFor,
  loadConfig,
  rerankLabel,
  resolveRerank,
  type Env,
  type EnvKey,
  type RerankDecision,
  type UseCaseId,
} from "../config.js";
import { createEmbedder, createVoyage, type Embedder, type VoyageLike } from "../embeddings.js";
import { createLlm, type Llm } from "../llm.js";
import { setLogLevel } from "../logger.js";
import { RateLimiter } from "../ratelimit.js";
import type { CliArgs } from "../cli.js";
import { ensureChroma } from "../retrieve/dense.js";
import { rerank } from "../retrieve/rerank.js";
import { embeddedText, type Ranked } from "../retrieve/bm25.js";
import type { SearchIndex } from "../retrieve/searcher.js";

export interface Runtime {
  env: Env;
  chroma: ChromaClient;
  voyage: VoyageLike;
  embedder: Embedder;
  rerankLimiter: RateLimiter;
  rerank: RerankDecision;
  rerankModel: string;
  answerLlm(): Llm;
  fastLlm(): Llm;
  rerankLabel: string;
}

export interface RuntimeOptions {
  uc: UseCaseId;
  cli?: Pick<CliArgs, "rerank">;
  /** false = this use case never reranks (UC3) */
  useCaseRerank?: boolean;
  require: EnvKey[];
}

/** Keys every query/eval needs. */
export const QUERY_KEYS: EnvKey[] = ["GROQ_API_KEY", "VOYAGE_API_KEY"];

/** Chroma first (spec section 8), then validated config. Returns the validated env and the Chroma client. */
async function bootstrap(require: EnvKey[]): Promise<{ env: Env; chroma: ChromaClient }> {
  const chroma = await ensureChroma(loadConfig().CHROMA_URL);
  const env = loadConfig({ require });
  setLogLevel(env.LOG_LEVEL);
  return { env, chroma };
}

export async function createRuntime(o: RuntimeOptions): Promise<Runtime> {
  const { env, chroma } = await bootstrap(o.require);
  const voyage = createVoyage(env);
  const decision = resolveRerank({ cliFlag: o.cli?.rerank, env, useCaseOverride: o.useCaseRerank });
  const answerModel = answerModelFor(env, o.uc);
  return {
    env,
    chroma,
    voyage,
    embedder: createEmbedder(env, voyage),
    rerankLimiter: new RateLimiter(env.VOYAGE_RPM, env.VOYAGE_TPM),
    rerank: decision,
    rerankModel: env.VOYAGE_RERANK_MODEL,
    answerLlm: () => createLlm(env, answerModel),
    fastLlm: () => createLlm(env, env.GROQ_MODEL_FAST),
    rerankLabel: rerankLabel(decision, env.VOYAGE_RERANK_MODEL),
  };
}

export interface IngestContext {
  env: Env;
  chroma: ChromaClient;
  embedder: Embedder;
}

/** Ingest needs Voyage, and Gemini too unless it only builds the naive baseline. */
export async function createIngestContext(opts: { naive: boolean }): Promise<IngestContext> {
  const { env, chroma } = await bootstrap(opts.naive ? ["VOYAGE_API_KEY"] : ["VOYAGE_API_KEY", "GEMINI_API_KEY", "GEMINI_MODEL_VISION"]);
  return { env, chroma, embedder: createEmbedder(env) };
}

const RERANK_SHARE_OF_TPM = 0.6;

export interface RerankStageResult {
  ranked: Ranked[];
  used: boolean;
  note: string;
  error?: string;
}

/** Rerank node body: off → keep fused order (top finalK); on → Voyage rerank with cache + fallback. */
export async function rerankStage(
  rt: Runtime,
  index: SearchIndex,
  query: string,
  fused: Ranked[],
  finalK: number,
): Promise<RerankStageResult> {
  if (!rt.rerank.enabled) return { ranked: fused.slice(0, finalK), used: false, note: `Rerank skipped (${rt.rerank.reason})` };
  const candidates = fused.map((r) => ({ id: r.id, text: embeddedText(index.chunk(r.id)) }));
  const out = await rerank(query, candidates, finalK, {
    client: rt.voyage,
    model: rt.rerankModel,
    limiter: rt.rerankLimiter,
    maxRetries: rt.env.MAX_RETRIES,
    // one rerank request must fit the per-minute token limit (shared with embeddings), or it can never succeed
    maxTokens: Math.floor(rt.env.VOYAGE_TPM * RERANK_SHARE_OF_TPM),
  });
  if (!out.used)
    return {
      ranked: fused.slice(0, finalK),
      used: false,
      error: out.error,
      note: `Rerank FAILED, kept fused order (${(out.error ?? "").slice(0, 80)})`,
    };
  return {
    ranked: out.ranked,
    used: true,
    note: `Reranked ${out.candidatesSent} of ${out.candidatesTotal} candidates with Voyage ${rt.rerankModel}${out.fromCache ? " (cached)" : ""}`,
  };
}
