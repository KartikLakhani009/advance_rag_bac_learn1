import { DiskCache, hashOf } from "../cache.js";
import { createLogger } from "../logger.js";
import type { RateLimiter } from "../ratelimit.js";
import { withRetry } from "../retry.js";
import { countTokens } from "../text/tokens.js";
import { recordUsage } from "../usage.js";
import type { VoyageLike } from "../embeddings.js";
import type { Ranked } from "./bm25.js";

const log = createLogger("rerank");

export interface RerankCandidate {
  id: string;
  text: string;
}

/** Our token estimate is cl100k; Voyage counts more, so scale up. */
const TOKEN_ESTIMATE_SCALE = 1.3;

/**
 * Keep the best-ranked candidates whose total request size fits `maxTokens` (Voyage bills query tokens once per
 * document plus the document tokens). Always keeps at least one. A request larger than the provider's per-minute
 * limit can never succeed, so sending fewer candidates is better than failing back to the fused order.
 */
export function fitCandidates(query: string, candidates: RerankCandidate[], maxTokens: number): RerankCandidate[] {
  const perQuery = countTokens(query);
  const kept: RerankCandidate[] = [];
  let used = 0;
  for (const c of candidates) {
    const cost = Math.ceil((countTokens(c.text) + perQuery) * TOKEN_ESTIMATE_SCALE);
    if (kept.length > 0 && used + cost > maxTokens) break;
    kept.push(c);
    used += cost;
  }
  return kept;
}

export interface RerankOutcome {
  ranked: Ranked[];
  used: boolean;
  fromCache: boolean;
  error?: string;
  /** how many of the fused candidates were sent (the rest did not fit the token budget) */
  candidatesSent?: number;
  candidatesTotal?: number;
}

export interface RerankOptions {
  client: VoyageLike;
  model: string;
  limiter?: RateLimiter;
  maxRetries: number;
  cache?: DiskCache;
  /** per-request token budget; lower-ranked candidates beyond it are not sent */
  maxTokens?: number;
  retrySleep?: (ms: number) => Promise<void>;
}

/**
 * Voyage rerank API. Results are cached by (query, sorted candidate IDs, model) so repeated queries make no
 * API call. If the call fails after retries the fused order is returned with `used: false`:
 * a query must never crash because of rerank.
 */
export async function rerank(query: string, allCandidates: RerankCandidate[], topK: number, o: RerankOptions): Promise<RerankOutcome> {
  const candidates = o.maxTokens ? fitCandidates(query, allCandidates, o.maxTokens) : allCandidates;
  const sizes = { candidatesSent: candidates.length, candidatesTotal: allCandidates.length };
  const fused: Ranked[] = candidates.map((c, i) => ({ id: c.id, score: 1 / (1 + i) }));
  if (candidates.length === 0) return { ranked: [], used: false, fromCache: false, ...sizes };
  const cache = o.cache ?? new DiskCache("rerank");
  const key = hashOf({ query, ids: candidates.map((c) => c.id).sort(), model: o.model });
  const hit = cache.get<Ranked[]>(key, o.model);
  if (hit) return { ranked: hit.slice(0, topK), used: true, fromCache: true, ...sizes };

  try {
    const est = countTokens(query) * candidates.length + candidates.reduce((s, c) => s + countTokens(c.text), 0);
    await o.limiter?.acquire(est);
    const res = await withRetry(
      () => o.client.rerank({ query, documents: candidates.map((c) => c.text), model: o.model, topK: Math.min(topK, candidates.length) }),
      { maxRetries: o.maxRetries, baseMs: o.retrySleep ? 1000 : 20_000, label: "voyage.rerank", sleep: o.retrySleep },
    );
    recordUsage(o.model, res.usage?.totalTokens ?? est, 0);
    const data = res.data ?? [];
    if (data.length === 0) throw new Error("empty rerank response");
    const ranked = data
      .filter((d) => d.index !== undefined && candidates[d.index])
      .map((d) => ({ id: candidates[d.index!]!.id, score: d.relevanceScore ?? 0 }))
      .sort((a, b) => b.score - a.score);
    cache.set(key, ranked);
    return { ranked: ranked.slice(0, topK), used: true, fromCache: false, ...sizes };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    log.warn(`rerank failed, falling back to fused order: ${msg.slice(0, 160)}`);
    return { ranked: fused.slice(0, topK), used: false, fromCache: false, error: msg, ...sizes };
  }
}
