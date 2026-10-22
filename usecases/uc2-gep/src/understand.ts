import { DiskCache, hashOf } from "@rag/core/src/cache.js";
import { completeJson, type Llm } from "@rag/core/src/llm.js";
import { UNDERSTAND_PROMPT_VERSION, understandSystem } from "@rag/core/src/prompts.js";
import { QueryUnderstanding, REGIONS } from "@rag/core/src/schemas.js";
import { routeByRules, type Routing } from "./regions.js";

export interface Understood extends Routing {
  search_query: string;
  source: "llm" | "rules";
}

/**
 * One Groq call → Zod-validated JSON, then guard rails in code: a region not in the list is dropped, and a chapter
 * is kept only when the question literally says "Chapter N" (a wrong filter hides the answer; a missing one
 * only makes search slightly worse).
 */
export async function understandWithLlm(llm: Llm, question: string): Promise<Understood> {
  // cached by (question, model, prompt version): the ladder re-asks the same questions several times
  const cache = new DiskCache("uc2/understand");
  const key = hashOf({ question, model: llm.model, v: UNDERSTAND_PROMPT_VERSION });
  const cached = cache.get<QueryUnderstanding>(key, llm.model);
  const raw = cached ?? (await completeJson(llm, QueryUnderstanding, understandSystem(), `Question: ${question}`));
  if (!cached) cache.set(key, raw);
  const literalChapter = /\bchapter\s+([1-4])\b/i.exec(question);
  return {
    region: raw.region && (REGIONS as readonly string[]).includes(raw.region) ? raw.region : null,
    chapter: literalChapter ? Number(literalChapter[1]) : null,
    executive_summary: raw.executive_summary && /executive summary/i.test(question),
    box: raw.box && /\bbox\b/i.test(question),
    search_query: raw.search_query.trim() || question,
    source: "llm",
  };
}

export function understandWithRules(question: string): Understood {
  return { ...routeByRules(question), search_query: question, source: "rules" };
}
