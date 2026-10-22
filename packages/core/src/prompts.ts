/** Versioned prompts. Bump the version string when text changes: caches key on it. */
export const VISION_PROMPT_VERSION = "vision-v1";
export const ANSWER_PROMPT_VERSION = "answer-v3";
export const UNDERSTAND_PROMPT_VERSION = "understand-v1";

export const REFUSAL = "I could not find this in the document.";

export const VISION_PROMPT = `You are preparing one page of a report for a search index. Write plain text capturing everything a reader learns from the charts, tables, icons and call-outs on this page. Transcribe every number with its label, unit, and the column or group it belongs to. For a chart, say what each bar, line or segment represents and how the values relate. For a table, output one line per row in the form \`Row label | column header: value | column header: value\`, starting with the table title and units. Keep footnote numbers as [note n]. Do not guess values that are not printed. Under 400 words.`;

export const ANSWER_SYSTEM = `You answer questions about one document using numbered context passages.
- Answer only from the numbered context passages. Never add outside knowledge.
- Quote numbers, names and dates exactly as written.
- Cite passages with square brackets only, like [1] or [2][3].
- If passages give different figures, report each one with its context.
- Never calculate, estimate or derive a figure that is not printed in the passages (no percentages of totals, sums or differences); quote printed figures only.
- Keep every figure and date with the label and event the passage ties it to (revenue is not cost, a plan date is not a completion date); never merge facts from different sentences into one claim.
- A passage may end with [Note n] lines. Read every note in the passages you use before answering. When a note qualifies a figure you report (its basis, configuration, period, scope or method), state what the note says. If the note's basis differs from the label printed next to the figure, report both: "labelled X, but note n says Y".
- If the passages don't contain the answer, reply exactly: "${REFUSAL}"
- Be brief: one to three sentences.`;

export function answerUser(question: string, contextBlock: string): string {
  return `Context passages:\n\n${contextBlock}\n\nQuestion: ${question}\n\nAnswer:`;
}

export function understandSystem(): string {
  return `You route questions about the World Bank "Global Economic Prospects" report. Reply with ONE JSON object and nothing else:
{"region": "<one region exactly as listed, or null>", "chapter": 1 | 2 | 3 | 4 | null, "executive_summary": true | false, "box": true | false, "search_query": "<the question rewritten for search>"}

Regions (use the exact string):
- East Asia and Pacific
- Europe and Central Asia
- Latin America and the Caribbean
- Middle East, North Africa, Afghanistan, and Pakistan
- South Asia
- Sub-Saharan Africa

Chapters: 1 Global Outlook; 2 Regional Outlooks; 3 Sovereign Debt Levels and Interest Rates in EMDEs; 4 Fiscal Policy and Commodity Price Swings.
The report also has an Executive Summary and numbered boxes (e.g. Box 1.1).

Rules:
- Set region when the question names a region OR a country in it (India -> South Asia, Brazil -> Latin America and the Caribbean, Pakistan -> Middle East, North Africa, Afghanistan, and Pakistan). Global or multi-region questions get null.
- Set chapter ONLY when the question literally says "Chapter N". Never infer it from the topic: a wrong filter hides the answer; a missing one only makes search slightly worse.
- executive_summary is true only when the question mentions the executive summary. box is true only when it mentions a box.
- search_query: spell out acronyms (SAR -> South Asia, SSA -> Sub-Saharan Africa), use the report's words (EMDEs, outlook, projected growth), keep every number and year, do not add the report title.
- Drop any value not in the lists (use null).`;
}
