/**
 * Gold page verification (build step 12): for every eval question with an `evidence` string, list the PDF pages of
 * the extracted + repaired text that contain it, and flag gold pages that do not.
 *   npm run verify:gold
 */
import path from "node:path";
import { loadQuestions } from "@rag/core/src/eval/run.js";
import * as uc1 from "../usecases/uc1-gpo/src/chunks.js";
import * as uc2 from "../usecases/uc2-gep/src/chunks.js";
import * as uc3 from "../usecases/uc3-imac/src/chunks.js";

const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

function check(uc: string, pageText: Map<number, string>) {
  console.log(`\n== ${uc}`);
  for (const q of loadQuestions(path.join("usecases", uc, "eval", "questions.yaml"))) {
    if (q.type === "refusal") continue;
    if (!q.evidence) {
      console.log(`${q.id}: no evidence string; gold pages ${q.goldPages.join(", ") || "(none)"} (page-only check)`);
      continue;
    }
    const e = norm(q.evidence);
    const pages = [...pageText].filter(([, t]) => norm(t).includes(e)).map(([p]) => p);
    const missing = q.goldPages.filter((g) => !pages.includes(g));
    console.log(
      `${q.id}: "${q.evidence}" on PDF pages ${pages.join(", ") || "—"}; gold ${q.goldPages.join(", ") || "(none)"}${missing.length ? `  ⚠ gold pages without the evidence (vision/table pages may carry it): ${missing.join(", ")}` : "  ✔"}`,
    );
  }
}

const u1 = uc1.loadUc1();
check("uc1-gpo", new Map(u1.built.pages.map((p) => [p.page, p.elements.map((e) => e.text).join(" ")])));
const u2 = uc2.loadUc2();
check("uc2-gep", new Map(u2.built.pages.map((p) => [p.page, p.elements.map((e) => e.text).join(" ")])));
const u3 = uc3.loadUc3();
check(
  "uc3-imac",
  new Map(
    u3.built.pages.map((p) => [
      p.page,
      p.elements.map((e) => e.text).join(" ") + " " + (u3.tables.get(p.page) ?? []).map((t) => t.text).join(" "),
    ]),
  ),
);
