import { createLogger } from "./logger.js";

const log = createLogger("retry");

export interface RetryOptions {
  maxRetries: number;
  baseMs?: number;
  label?: string;
  sleep?: (ms: number) => Promise<void>;
}

function retryAfterMs(err: unknown): number | undefined {
  const e = err as { headers?: Record<string, string>; response?: { headers?: { get?: (k: string) => string | null } } };
  const h = e?.headers?.["retry-after"] ?? e?.response?.headers?.get?.("retry-after");
  const n = h ? Number(h) : NaN;
  return Number.isFinite(n) ? n * 1000 : undefined;
}

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string };
  const s = e?.status;
  if (s === 429 || (s !== undefined && s >= 500)) return true;
  if (e?.code && /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR/.test(e.code)) return true;
  return /429|rate limit|timeout|temporar|overloaded|fetch failed/i.test(e?.message ?? "");
}

/** Exponential backoff with jitter; honours Retry-After. Non-retryable errors throw immediately. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.maxRetries || !isRetryable(err)) throw err;
      const backoff = (opts.baseMs ?? 1000) * 2 ** attempt;
      const delay = Math.max(retryAfterMs(err) ?? 0, backoff) * (0.8 + Math.random() * 0.4);
      attempt++;
      log.warn(
        `${opts.label ?? "call"} failed (${(err as Error).message?.slice(0, 120)}); retry ${attempt}/${opts.maxRetries} in ${Math.round(delay)}ms`,
      );
      await sleep(delay);
    }
  }
}
