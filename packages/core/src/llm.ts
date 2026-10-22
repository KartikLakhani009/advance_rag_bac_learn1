import { ChatGroq } from "@langchain/groq";
import type { z } from "zod";
import type { Env } from "./config.js";
import { createLogger } from "./logger.js";
import { RateLimiter } from "./ratelimit.js";
import { withRetry } from "./retry.js";

/** Groq's shared key has per-minute and per-day token limits: back off for real before retrying a 429. */
const RATE_LIMIT_BACKOFF = { minRetries: 6, baseMs: 10_000 } as const;
import { recordUsage } from "./usage.js";

const log = createLogger("llm");

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Llm {
  model: string;
  complete(system: string, user: string): Promise<LlmResult>;
}

const limiters = new Map<string, RateLimiter>();

/** Groq chat model behind a shared RPM limiter and retry-with-backoff. */
export function createLlm(env: Env, model: string): Llm {
  const chat = new ChatGroq({
    apiKey: env.GROQ_API_KEY!,
    model,
    temperature: 0,
    maxRetries: 0,
    // gpt-oss models spend tokens on reasoning; "low" keeps short answers cheap and fast
    reasoningEffort: model.includes("gpt-oss") ? "low" : undefined,
  });
  const limiter = limiters.get("groq") ?? new RateLimiter(env.GROQ_RPM);
  limiters.set("groq", limiter);
  return {
    model,
    async complete(system, user) {
      await limiter.acquire();
      const res = await withRetry(
        () =>
          chat.invoke([
            ["system", system],
            ["user", user],
          ]),
        { maxRetries: Math.max(env.MAX_RETRIES, RATE_LIMIT_BACKOFF.minRetries), baseMs: RATE_LIMIT_BACKOFF.baseMs, label: `groq:${model}` },
      );
      const text = typeof res.content === "string" ? res.content : res.content.map((p) => ("text" in p ? p.text : "")).join("");
      const u = res.usage_metadata;
      recordUsage(model, u?.input_tokens ?? 0, u?.output_tokens ?? 0);
      return { text: text.trim(), inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0 };
    },
  };
}

/** Pull the first balanced {...} out of a model reply (models sometimes wrap JSON in prose or fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in reply");
}

/** One LLM call whose reply must satisfy a Zod schema; one corrective retry on invalid output. */
export async function completeJson<T>(llm: Llm, schema: z.ZodType<T>, system: string, user: string): Promise<T> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.complete(
      system,
      attempt === 0 ? user : `${user}\n\nYour previous reply was invalid (${lastErr}). Reply with ONE valid JSON object only.`,
    );
    try {
      return schema.parse(extractJson(res.text));
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 160);
      log.warn(`structured output invalid (attempt ${attempt + 1}): ${lastErr}`);
    }
  }
  throw new Error(`LLM did not return valid JSON: ${lastErr}`);
}
