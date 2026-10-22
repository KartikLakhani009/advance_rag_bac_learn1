import { VoyageAIClient } from "voyageai";
import { JsonKV, sha256 } from "./cache.js";
import type { Env } from "./config.js";
import { createLogger } from "./logger.js";
import { RateLimiter } from "./ratelimit.js";
import { withRetry } from "./retry.js";
import { countTokens } from "./text/tokens.js";
import { recordCacheHit, recordUsage } from "./usage.js";

const log = createLogger("embed");

/** The slice of the Voyage client we use, so tests can mock it. */
export interface VoyageLike {
  embed(req: { input: string[]; model: string; inputType?: "query" | "document" }): Promise<{
    data?: Array<{ embedding?: number[] }>;
    usage?: { totalTokens?: number };
  }>;
  rerank(req: { query: string; documents: string[]; model: string; topK?: number }): Promise<{
    data?: Array<{ index?: number; relevanceScore?: number }>;
    usage?: { totalTokens?: number };
  }>;
}

export function createVoyage(env: Env): VoyageLike {
  const client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY! });
  return { embed: (req) => client.embed(req), rerank: (req) => client.rerank(req) };
}

export function createEmbedder(env: Env, client: VoyageLike = createVoyage(env)): Embedder {
  return new Embedder({ client, model: env.VOYAGE_EMBED_MODEL, rpm: env.VOYAGE_RPM, tpm: env.VOYAGE_TPM, maxRetries: env.MAX_RETRIES });
}

/** Voyage's free tier (3 RPM) is shared across processes: a 429 needs a real wait, not a quick retry. */
const RATE_LIMIT_BACKOFF = { minRetries: 6, baseMs: 30_000 } as const;
/** Our token estimate is cl100k; Voyage's tokenizer counts more, so scale up and stay well under TPM per request. */
const TOKEN_ESTIMATE_SCALE = 1.3;
const BATCH_SHARE_OF_TPM = 0.4;
const MAX_INPUTS_PER_REQUEST = 128;

const encode = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString("base64");
const decode = (s: string): number[] => {
  const b = Buffer.from(s, "base64");
  return Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
};

export interface EmbedderOptions {
  client: VoyageLike;
  model: string;
  rpm: number;
  tpm: number;
  maxRetries: number;
  namespace?: string;
  limiter?: RateLimiter;
}

/**
 * Voyage embeddings. Document and query inputs use the matching `inputType`. Texts are batched by token
 * budget (one request must fit under TPM), every vector is cached on disk by (model, type, text hash),
 * and calls go through the shared rate limiter.
 */
export class Embedder {
  private readonly store: JsonKV<string>;
  private readonly limiter: RateLimiter;

  constructor(private readonly o: EmbedderOptions) {
    this.store = new JsonKV<string>(o.namespace ?? "embeddings", o.model.replace(/[^\w.-]/g, "_"));
    this.limiter = o.limiter ?? new RateLimiter(o.rpm, o.tpm);
  }

  private key(text: string, type: string): string {
    return `${type}:${sha256(text)}`;
  }

  async embedDocuments(texts: string[], onProgress?: (done: number, total: number) => void): Promise<number[][]> {
    return this.embedMany(texts, "document", onProgress);
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.embedMany([text], "query"))[0]!;
  }

  private async embedMany(texts: string[], type: "document" | "query", onProgress?: (d: number, t: number) => void): Promise<number[][]> {
    const out: Array<number[] | undefined> = texts.map((t) => {
      const hit = this.store.get(this.key(t, type));
      if (hit) {
        recordCacheHit(this.o.model);
        return decode(hit);
      }
      return undefined;
    });
    const todo = out.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (todo.length === 0) return out as number[][];

    // token-aware batches
    const budget = Math.floor(this.o.tpm * BATCH_SHARE_OF_TPM);
    const estimate = (text: string) => Math.min(Math.ceil(countTokens(text) * TOKEN_ESTIMATE_SCALE), budget);
    const batches: number[][] = [];
    let cur: number[] = [];
    let tok = 0;
    for (const i of todo) {
      const t = estimate(texts[i]!);
      if (cur.length && (tok + t > budget || cur.length >= MAX_INPUTS_PER_REQUEST)) {
        batches.push(cur);
        cur = [];
        tok = 0;
      }
      cur.push(i);
      tok += t;
    }
    if (cur.length) batches.push(cur);

    let done = texts.length - todo.length;
    for (const batch of batches) {
      const input = batch.map((i) => texts[i]!);
      const est = input.reduce((sum, t) => sum + estimate(t), 0);
      await this.limiter.acquire(est);
      const res = await withRetry(() => this.o.client.embed({ input, model: this.o.model, inputType: type }), {
        maxRetries: Math.max(this.o.maxRetries, RATE_LIMIT_BACKOFF.minRetries),
        baseMs: RATE_LIMIT_BACKOFF.baseMs,
        label: "voyage.embed",
      });
      const data = res.data ?? [];
      if (data.length !== input.length) throw new Error(`Voyage returned ${data.length} embeddings for ${input.length} inputs`);
      recordUsage(this.o.model, res.usage?.totalTokens ?? est, 0);
      batch.forEach((i, j) => {
        const v = data[j]!.embedding!;
        out[i] = v;
        this.store.set(this.key(texts[i]!, type), encode(v));
      });
      this.store.flush();
      done += batch.length;
      onProgress?.(done, texts.length);
      log.debug(`embedded batch of ${batch.length} (~${est} tokens)`);
    }
    return out as number[][];
  }
}
