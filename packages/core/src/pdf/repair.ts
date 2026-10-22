/**
 * Text repair, applied at extraction time before any chunking.
 * NFKC (ligatures ﬂ ﬁ), the dropped "Th" ligature word map, hyphenation joins.
 */

/** Damaged → correct. The PDF font drops the "Th" ligature glyph, leaving "Te conflict". */
export const TH_MAP: Record<string, string> = {
  Te: "The",
  Tis: "This",
  Tey: "They",
  Tere: "There",
  Tese: "These",
  Tose: "Those",
  Ten: "Then",
  Tus: "Thus",
  Tird: "Third",
  Tat: "That",
  Tan: "Than",
  Teir: "Their",
  Tem: "Them",
  Terefore: "Therefore",
  Tereafter: "Thereafter",
  Trough: "Through",
  Troughout: "Throughout",
  Tree: "Three",
  Tousand: "Thousand",
  Tirty: "Thirty",
  Tirteen: "Thirteen",
  Teory: "Theory",
  Tink: "Think",
  Tings: "Things",
  Tough: "Though",
  Tailand: "Thailand",
};

/** Keys that are real English words too ("Ten countries", "Tan"): only fixed in a "Then …" context. */
const AMBIGUOUS: Record<string, RegExp> = {
  Ten: /^(?:,|\s+(?:the|a|an|we|they|it|he|she|i|there|this|these|those|in|as|for|to|after|when|if|on|by|with|from|and|is|are|was|were|both|each|both|projected|growth)\b)/,
  Tan: /^\s+(?:in|the|a|that|\d|last|expected|previously|anticipated|projected)\b/,
  Tree: /^\s+(?:\w+\s+){0,1}(?:percent|years|months|countries|quarters|economies)\b/,
  Tough: /^\s+(?:the|a|an|its|their|this|these|those|not|many|some|most|all|despite|there|they|it|we)\b/,
  Trough: /^\s+(?:the|a|an|this|these|those|its|their|our|out|which|\d|\w+ing\b)/,
};
// "Tree" really is "Three" only before a plural/quantity noun; "Tan" really is "Than" after a comparative.

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .replace(/[\u2000-\u200a\u00a0]/g, " ");
}

export interface Vocab {
  /** lower-cased token counts (hyphen joins) */
  counts: Map<string, number>;
  /** exact-case token counts: "ten" in lower case is evidence that "Ten" can be a real word */
  exact: Map<string, number>;
}

export function buildVocab(texts: Iterable<string>): Vocab {
  const counts = new Map<string, number>();
  const exact = new Map<string, number>();
  for (const t of texts) {
    for (const w of t.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []) {
      const k = w.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
      exact.set(w, (exact.get(w) ?? 0) + 1);
    }
  }
  return { counts, exact };
}

/**
 * Repair "Th" ligature damage. A word is rewritten only when it sits on a word boundary AND the damaged
 * form is absent from the document's normal vocabulary (frequency in mid-sentence position of the
 * lower-cased damaged form is ~0; "Tey" is never a real word, "Ten" is checked by context).
 */
export function fixThLigature(text: string): string {
  return text.replace(
    /(^|[^A-Za-z0-9’'])(T[a-z]{1,9})(?![A-Za-z0-9’'])/g,
    (match, pre: string, word: string, offset: number, whole: string) => {
      const fix = TH_MAP[word];
      if (!fix) return match;
      // "Te", "Tis", "Tey" … are never words, so they are always repaired. Keys that are also real words
      // ("Ten", "Tan", "Tree", "Tough", "Trough") are repaired only when the following words say it was
      // "Then"/"Than"/"Three"/"Though"/"Through" (see AMBIGUOUS).
      const amb = AMBIGUOUS[word];
      if (amb) {
        const rest = whole.slice(offset + match.length);
        if (!amb.test(rest)) return match;
      }
      return pre + fix;
    },
  );
}

/**
 * Join lines of one paragraph. Words hyphenated across a line break are re-joined:
 * "sustainabil-" + "ity" → "sustainability". If the glued form is unknown but the hyphenated form is a
 * real compound in the document ("long-term"), keep the hyphen.
 */
export function joinLines(lines: string[], vocab?: Vocab): string {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) {
      out = line;
      continue;
    }
    const m = /([A-Za-z]+)-$/.exec(out);
    const next = /^([a-z]+)/.exec(line);
    if (m && next && !/\s[–—-]$/.test(out)) {
      const glued = (m[1]! + next[1]!).toLowerCase();
      const hyph = `${m[1]!}-${next[1]!}`.toLowerCase();
      const gluedKnown = (vocab?.counts.get(glued) ?? 0) > 0;
      const hyphKnown = (vocab?.counts.get(hyph) ?? 0) > 0;
      if (hyphKnown && !gluedKnown)
        out += line; // keep the hyphen: "long-" + "term"
      else out = out.slice(0, -1) + line;
    } else {
      out += " " + line;
    }
  }
  return out;
}

/** Collapse hyphenation left inside a single string ("sustainabil- ity"). */
export function joinInlineHyphenation(text: string, vocab?: Vocab): string {
  return text.replace(/([A-Za-z]{2,})-\s+([a-z]{2,})/g, (_match, a: string, b: string) => {
    const glued = (a + b).toLowerCase();
    const hyph = `${a}-${b}`.toLowerCase();
    if ((vocab?.counts.get(hyph) ?? 0) > 0 && !(vocab?.counts.get(glued) ?? 0)) return `${a}-${b}`;
    return a + b;
  });
}

export function repairText(text: string, vocab?: Vocab): string {
  return fixThLigature(joinInlineHyphenation(normalizeText(text), vocab))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
