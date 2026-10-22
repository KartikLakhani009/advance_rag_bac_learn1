import open from "open";
import type { QueryResult } from "./schemas.js";

const link = (abs: string) => (process.stdout.isTTY ? `\u001b]8;;file://${encodeURI(abs)}\u0007${abs}\u001b]8;;\u0007` : abs);

export interface PresentOptions {
  debug?: boolean;
  rerankLabel: string;
  rerankNote?: string;
  openImages?: boolean;
}

/** CLI output: answer, citations (printed page; PDF page with --debug), image paths, rerank mode, trace. */
export async function presentResult(r: QueryResult, o: PresentOptions): Promise<void> {
  const out: string[] = [];
  out.push("", `Q: ${r.question}`, "", `A: ${r.answer}`, "");
  if (r.citations.length) {
    out.push("Citations:");
    for (const c of r.citations) {
      const pp = c.printedPage === c.printedPageEnd ? c.printedPage : `${c.printedPage}–${c.printedPageEnd}`;
      const pdf = o.debug ? ` (PDF ${c.page === c.pageEnd ? c.page : `${c.page}–${c.pageEnd}`})` : "";
      out.push(`  [${c.n}] p. ${pp}${pdf}${c.headingPath ? ` — ${c.headingPath}` : ""}`);
    }
    out.push("");
  }
  if (r.images.length) {
    out.push("Images:");
    for (const im of r.images)
      out.push(`  ${im.type} p. ${im.printedPage}: ${link(im.absolutePath)}${im.caption ? `  (${im.caption.slice(0, 80)})` : ""}`);
    out.push("");
  }
  out.push(o.rerankLabel + (o.rerankNote ? ` — ${o.rerankNote}` : ""));
  out.push("Trace:");
  for (const t of r.trace) out.push(`  ${t.stage}: ${t.note}`);
  if (o.debug && r.debug) {
    out.push("", "Debug:");
    out.push(`  filters: ${JSON.stringify(r.debug.filters)}`);
    out.push(`  rewrittenQuery: ${r.debug.rewrittenQuery ?? "-"}`);
    out.push(`  rerankUsed: ${r.debug.rerankUsed}${r.debug.rerankModel ? ` (${r.debug.rerankModel})` : ""}`);
    out.push("  final:");
    for (const f of r.debug.final)
      out.push(
        `    ${f.score.toFixed(4)} ${f.kind} PDF ${f.page}${f.pageEnd !== f.page ? `–${f.pageEnd}` : ""} (p. ${f.printedPage}) ${f.chunkId}`,
      );
    out.push(`  usage: ${JSON.stringify(r.debug.usage)}`);
  }
  console.log(out.join("\n"));
  if (o.openImages) for (const im of r.images) await open(im.absolutePath);
}
