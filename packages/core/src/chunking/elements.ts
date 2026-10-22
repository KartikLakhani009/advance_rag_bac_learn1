import type { Chunk } from "../schemas.js";
import { countTokens } from "../text/tokens.js";

const MARKER = /\[\^(\d{1,2})\]/g;

/** Footnote numbers used in a text, in order of first appearance. */
export function markersIn(text: string): number[] {
  return [...new Set([...text.matchAll(MARKER)].map((m) => Number(m[1])))];
}

/**
 * Endnote linking: every `[^n]` marker is removed from the body and the matching endnote is appended as
 * `[Note n] <text, max 700 chars>`. A marker with no parsed endnote is simply dropped.
 */
export function attachEndnotes(
  text: string,
  notes: Map<number, string>,
  maxChars = 700,
  alsoNotes: number[] = [],
): { text: string; noteNumbers: number[] } {
  const nums = [...new Set([...markersIn(text), ...alsoNotes])].filter((n) => notes.has(n)).sort((a, b) => a - b);
  const body = text
    .replace(MARKER, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  const appended = nums.map((n) => `[Note ${n}] ${notes.get(n)!.slice(0, maxChars)}`);
  return { text: appended.length ? `${body}\n${appended.join("\n")}` : body, noteNumbers: nums };
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Endnotes that are *about* a table even though no marker points at them: the note text begins with the table title
 * ("Greenhouse gas emissions were calculated…" belongs to the table "Greenhouse gas emissions"). Needs ≥ 2 words so a
 * title like "Configuration" cannot match unrelated notes.
 */
export function notesAboutTitle(title: string, notes: Map<number, string>): number[] {
  const t = squash(title.replace(/\s*\(.*\)\s*$/, ""));
  if (t.split(" ").length < 2 || t.length < 12) return [];
  return [...notes].filter(([, text]) => squash(text).startsWith(t)).map(([n]) => n);
}

/** Rewrite a chunk's text with its endnotes attached; page metadata is untouched. */
export function withEndnotes(c: Chunk, notes: Map<number, string>, alsoNotes: number[] = []): Chunk {
  const { text } = attachEndnotes(c.text, notes, 700, alsoNotes);
  return { ...c, text, tokens: countTokens(text) };
}
