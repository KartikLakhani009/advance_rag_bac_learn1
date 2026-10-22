import { GoogleGenAI } from "@google/genai";
import type * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import { DiskCache, hashOf, sha256 } from "./cache.js";
import type { Env } from "./config.js";
import { createLogger } from "./logger.js";
import { VISION_PROMPT, VISION_PROMPT_VERSION } from "./prompts.js";
import { RateLimiter } from "./ratelimit.js";
import { renderPagePng } from "./pdf/render.js";
import { withRetry } from "./retry.js";
import { VisionPagesConfig } from "./schemas.js";
import { recordUsage } from "./usage.js";

const log = createLogger("vision");

/** Load vision-pages.json, validate with Zod and fail clearly on out-of-range pages. */
export function loadVisionPages(file: string, pageCount: number): VisionPagesConfig {
  const parsed = VisionPagesConfig.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success)
    throw new Error(`${path.basename(file)} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const bad = parsed.data.pages.filter((p) => p.page < 1 || p.page > pageCount).map((p) => p.page);
  if (bad.length)
    throw new Error(`${path.basename(file)} lists page(s) ${bad.join(", ")} but the PDF has only ${pageCount} pages (1-based PDF pages).`);
  const dupes = parsed.data.pages.map((p) => p.page).filter((p, i, a) => a.indexOf(p) !== i);
  if (dupes.length) throw new Error(`${path.basename(file)} lists page(s) ${[...new Set(dupes)].join(", ")} more than once.`);
  return parsed.data;
}

export interface VisionClient {
  describe(png: Uint8Array, pageText: string): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

export function createGemini(env: Env): VisionClient {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });
  const limiter = new RateLimiter(env.GEMINI_RPM);
  const model = env.GEMINI_MODEL_VISION!;
  return {
    async describe(png, pageText) {
      await limiter.acquire();
      const res = await withRetry(
        () =>
          ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType: "image/png", data: Buffer.from(png).toString("base64") } },
                  {
                    text: `${VISION_PROMPT}\n\nText extracted from this page (may be incomplete or out of order):\n${pageText.slice(0, 6000)}`,
                  },
                ],
              },
            ],
            config: { temperature: 0, maxOutputTokens: 1200 },
          }),
        { maxRetries: env.MAX_RETRIES, label: `gemini:${model}` },
      );
      const u = res.usageMetadata;
      recordUsage(model, u?.promptTokenCount ?? 0, u?.candidatesTokenCount ?? 0);
      return { text: (res.text ?? "").trim(), inputTokens: u?.promptTokenCount ?? 0, outputTokens: u?.candidatesTokenCount ?? 0 };
    },
  };
}

/**
 * Describe one listed page: render at ~110 DPI, send the image with the page's extracted text.
 * Cached by page-content hash + model + prompt version, so unchanged pages never hit the API again.
 */
export async function describePage(
  doc: mupdf.Document,
  pageNo: number,
  pageText: string,
  o: { client: VisionClient; model: string; namespace: string },
): Promise<{ text: string; png: Uint8Array; fromCache: boolean }> {
  const png = renderPagePng(doc, pageNo, 110);
  const key = hashOf({ page: sha256(png), text: sha256(pageText), model: o.model, prompt: VISION_PROMPT_VERSION });
  const cache = new DiskCache(`vision/${o.namespace}`);
  const hit = cache.get<{ text: string }>(key, o.model);
  if (hit) {
    log.info(`page ${pageNo}: cache hit`);
    return { text: hit.text, png, fromCache: true };
  }
  log.info(`page ${pageNo}: calling ${o.model}`);
  const res = await o.client.describe(png, pageText);
  if (!res.text) throw new Error(`Vision model returned empty text for page ${pageNo}`);
  cache.set(key, { text: res.text });
  return { text: res.text, png, fromCache: false };
}
