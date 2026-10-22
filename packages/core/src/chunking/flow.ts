import type { Element } from "../schemas.js";
import { joinLines, type Vocab } from "../pdf/repair.js";
import { splitSentences } from "../text/sentences.js";
import { countTokens } from "../text/tokens.js";
import type { SentenceUnit } from "./sentence.js";

const TERMINAL = /[.!?:]["”’)\]]*(?:\[\^\d+\])*$/;

export interface FlowItem {
  el: Element;
  /** original page of the element */
  page: number;
  printedPage: string;
}

/**
 * Reading-ordered paragraphs → sentence units. A sentence that runs across a column/page break (the
 * paragraph ends without terminal punctuation and the next starts in lower case) is joined, and keeps
 * the page where it starts.
 */
export function flowToUnits(items: FlowItem[], vocab?: Vocab): SentenceUnit[] {
  const units: SentenceUnit[] = [];
  let carry: { text: string; page: number; printedPage: string } | undefined;
  const emit = (text: string, page: number, printedPage: string) => {
    for (const s of splitSentences(text)) units.push({ text: s, page, printedPage, tokens: countTokens(s) });
  };
  for (const it of items) {
    const t = it.el.text.trim();
    if (!t) continue;
    let text = t;
    let page = it.page;
    let printed = it.printedPage;
    if (carry) {
      if (/^[a-z(]/.test(t)) {
        text = joinLines([carry.text, t], vocab);
        page = carry.page;
        printed = carry.printedPage;
      } else emit(carry.text, carry.page, carry.printedPage);
      carry = undefined;
    }
    const sentences = splitSentences(text);
    if (!TERMINAL.test(text) && text.length > 40 && sentences.length > 0) {
      const last = sentences.pop()!;
      for (const s of sentences) units.push({ text: s, page, printedPage: printed, tokens: countTokens(s) });
      carry = { text: last, page: sentences.length ? it.page : page, printedPage: sentences.length ? it.printedPage : printed };
    } else for (const s of sentences) units.push({ text: s, page, printedPage: printed, tokens: countTokens(s) });
  }
  if (carry) emit(carry.text, carry.page, carry.printedPage);
  return units;
}
