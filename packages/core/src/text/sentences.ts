/**
 * Sentence splitting: Intl.Segmenter (built into Node) plus guards for things ICU splits wrongly:
 * abbreviations ("U.S. passports", "Fig. 3", "No. 5", "e.g."), a lone initial, footnote markers that
 * follow the full stop ("ENERGY STAR.[^18]"), and continuations that start in lower case.
 */
const ABBREV = new Set(
  [
    "u.s",
    "u.k",
    "u.n",
    "e.g",
    "i.e",
    "etc",
    "fig",
    "figs",
    "no",
    "nos",
    "vs",
    "dr",
    "mr",
    "mrs",
    "ms",
    "prof",
    "inc",
    "corp",
    "co",
    "ltd",
    "st",
    "jr",
    "sr",
    "approx",
    "est",
    "vol",
    "sec",
    "ch",
    "pp",
    "p",
    "cf",
    "al",
    "dept",
    "gov",
    "gen",
    "sen",
    "rep",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "oct",
    "nov",
    "dec",
    "a.m",
    "p.m",
    "d.c",
    "u.s.c",
  ].map((s) => s.toLowerCase()),
);

function endsWithAbbreviation(s: string): boolean {
  const m = /([A-Za-z](?:\.[A-Za-z])*)\.\s*$/.exec(s.trimEnd());
  if (!m) return false;
  const token = m[1]!.toLowerCase();
  if (ABBREV.has(token)) return true;
  // single capital initial: "John W. Crawford"
  if (/^[A-Z]$/.test(m[1]!)) return true;
  // dotted acronym such as "U.S." / "D.C."
  if (/^(?:[A-Za-z]\.)+[A-Za-z]$/.test(m[1]!)) return true;
  return false;
}

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

const MARK = "(?:\\[\\^\\d+\\])+";

export function splitSentences(text: string): string[] {
  // "STAR.[^18] We design" gives ICU no break after the full stop; segment "STAR[^18]. We design" instead and
  // restore the original order (full stop, then marker) afterwards.
  const pre = text.replace(new RegExp(`([.!?]["”’)]*)(${MARK})`, "g"), "$2$1");
  const raw = [...segmenter.segment(pre)].map((s) => s.segment.replace(new RegExp(`(${MARK})([.!?]["”’)]*)(\\s*)$`), "$2$1$3"));
  const out: string[] = [];
  for (const seg of raw) {
    const prev = out[out.length - 1];
    if (prev !== undefined) {
      const startsLower = /^\s*[a-z]/.test(seg);
      // ICU breaks after "[" in "STAR.[^18] Next": keep the marker whole
      if (/\[$/.test(prev) || /^\^\d+\]/.test(seg)) {
        out[out.length - 1] = prev + seg;
        continue;
      }
      const startsMarker = /^\s*\[\^/.test(seg);
      if (endsWithAbbreviation(prev) && !/^\s*[A-Z][a-z]+\s+(?:is|was|has|had|said|will)\b/.test(seg)) {
        out[out.length - 1] = prev + seg;
        continue;
      }
      if (startsLower || startsMarker) {
        out[out.length - 1] = prev + seg;
        continue;
      }
    }
    out.push(seg);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** True when the text ends like a finished sentence. */
export function endsOnSentenceBoundary(text: string): boolean {
  return /[.!?]["”’)\]]*(?:\[\^\d+\])*\s*$/.test(text.trimEnd()) && !endsWithAbbreviation(text.replace(/(?:\[\^\d+\])+\s*$/, ""));
}
