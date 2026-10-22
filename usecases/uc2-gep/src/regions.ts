import { REGIONS } from "@rag/core/src/schemas.js";
import type { Filter } from "@rag/core/src/retrieve/filters.js";

export { REGIONS };

/** Regex aliases per region: the report's acronym, the region name, and its countries (the question may name only a country). */
const ALIASES: Record<(typeof REGIONS)[number], RegExp> = {
  "East Asia and Pacific":
    /\b(east asia|pacific|EAP|china|chinese|indonesia|thailand|philippines|viet ?nam|malaysia|mongolia|cambodia|myanmar|lao pdr|fiji|papua new guinea|timor)\b/i,
  "Europe and Central Asia":
    /\b(europe and central asia|ECA|central asia|t[uü]rkiye|turkey|russia|russian federation|ukraine|poland|kazakhstan|romania|hungary|serbia|uzbekistan|georgia|armenia|azerbaijan|belarus|bulgaria|croatia)\b/i,
  "Latin America and the Caribbean":
    /\b(latin america|caribbean|LAC|brazil|mexico|argentina|colombia|chile|peru|ecuador|bolivia|uruguay|paraguay|venezuela|guatemala|honduras|jamaica|panama|costa rica|dominican republic)\b/i,
  "Middle East, North Africa, Afghanistan, and Pakistan":
    /\b(middle east|north africa|afghanistan|pakistan|MNA|MENAAP|egypt|iran|iraq|saudi arabia|morocco|algeria|tunisia|lebanon|jordan|yemen|syria|libya|djibouti|gulf cooperation|GCC)\b/i,
  "South Asia": /\b(south asia|SAR|india|indian|bangladesh|sri lanka|nepal|bhutan|maldives)\b/i,
  "Sub-Saharan Africa":
    /\b(sub-saharan|SSA|nigeria|south africa|ethiopia|kenya|angola|ghana|tanzania|uganda|c[oô]te d.ivoire|senegal|zambia|zimbabwe|mozambique|cameroon|rwanda|congo)\b/i,
};

export interface Routing {
  region: string | null;
  chapter: number | null;
  executive_summary: boolean;
  box: boolean;
}

/** Rules-based router: aliases per region (one match = region; several = multi-region = null), "Chapter N", "executive summary", "Box n". */
export function routeByRules(question: string): Routing {
  const hits = REGIONS.filter((r) => ALIASES[r].test(question));
  const ch = /\bchapter\s+([1-4])\b/i.exec(question);
  return {
    region: hits.length === 1 ? hits[0]! : null,
    chapter: ch ? Number(ch[1]) : null,
    executive_summary: /\bexecutive summary\b/i.test(question),
    box: /\bbox\s+\d/i.test(question),
  };
}

export const NOISE = ["table_fragment", "front_matter", "references"] as const;

/** Routing → the single Filter applied to Chroma and MiniSearch alike. */
export function toFilter(r: Routing): Filter {
  const f: Filter = { excludeKinds: [...NOISE] };
  if (r.region) f.region = r.region;
  if (r.chapter) f.chapter = r.chapter;
  if (r.executive_summary) f.kinds = ["executive_summary"];
  else if (r.box) f.kinds = ["box"];
  return f;
}

export function describeFilter(r: Routing): string {
  const parts = [
    r.region && `region=${r.region}`,
    r.chapter && `chapter=${r.chapter}`,
    r.executive_summary && "executive summary",
    r.box && "box",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no filter (global question)";
}
