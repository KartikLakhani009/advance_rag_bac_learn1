# UC3 — Apple iMac Product Environmental Report, Oct 2024 (short, visual)

`data/raw/iMac_PER_Oct2024.pdf` · 12 pages · pipeline: extraction + repair → **element chunks** (rebuilt tables, small prose groups, endnotes attached) + **vision chunks** for listed pages → hybrid → grounded answer. **Rerank is always off for UC3**, in every environment.

> Status of numbers: _measured offline_ = `npm run offline:bm25`, `verify:gold`, `npm test`; _measured with the APIs_ = `uc3:eval` and `uc3:eval -- --ladder`. No rerank run exists for UC3 by design.

## 1. What breaks

| Failure                                            | Real example                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Table values are separated from their columns.** | Naive text of PDF 10: `…iMac (two ports) 256GB Total product footprint 346 kg CO2e Apple emissions from utility-purchased electricity (scope 2) 0 kg CO2e … • Production 50% • Transportation 5% … GHG reductions achieved7 ↓>20% We model different configurations…` — the column header, the values and the next paragraph are one run; “7” is a footnote glued to “achieved”. Rebuilt: `Production: 50%` under `Table: Greenhouse gas emissions. Column: iMac (two ports) 256GB`. |
| **Caveats live in endnotes (pp. 11–12).**          | PDF 7: `iMac uses 58 percent less energy than the requirement for ENERGY STAR.18` — what “58 percent” is measured against (ENERGY STAR Program Requirements, max energy allowance, tested with the 143W power adapter) is only in endnote 18 on PDF 12. A chunk without Note 18 answers confidently and incompletely.                                                                                                                                                                |
| **Size-based chunks cut tables.**                  | 26 naive 1000-char chunks cut straight through the page-10 tables (a table and the next prose paragraph share a chunk).                                                                                                                                                                                                                                                                                                                                                              |
| **A chart says what the text does not.**           | PDF 2: `445 kg` `Baseline emissions`, `–99 kg` `Emissions reductions`, `346 kg` are separate text elements; the relation 445 − 99 = 346 is only visible in the bar chart.                                                                                                                                                                                                                                                                                                            |
| **A data inconsistency to report, not hide.**      | PDF 10 labels 346 kg as “iMac (two ports) 256GB”, but endnote 10 says the life-cycle assessment is based on the **512GB** configuration. Root cause of the earlier miss: endnote 10 is referenced only from the PDF 2 chart, so the page-10 table chunk never contained it. Fixed by attaching notes by table title plus the note rule in prompt v2; question S4 asks it directly.                                                                                                   |

## 2. Document anatomy

| Aspect         | Observation                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonts          | `SFHello-Light` 8.5 pt body (7–7.5 pt call-outs, 6.5 pt table cells), `SFHello-Semibold` headings (24 pt page titles, 14.9 pt sub-heads, 7 pt table header text), `SFHello-Medium`, `GreenMarker` icon font               |
| Layout         | the right three-quarters of each page carries text; page titles at left (`Carbon Footprint`, `Use`, `Make`); call-outs in columns; footer `iMac                                                                           | Product Environmental Report` + page number (repeated, removed) |
| Page numbering | PDF = printed (tested)                                                                                                                                                                                                    |
| Tables         | each sits under a **dark header bar** (filled rectangles, grey 0.23): p. 10 _Greenhouse gas emissions_ and _Configuration_; p. 12 _Power consumption for iMac_ (a super-header cell above three sub-cells 100V/115V/230V) |
| Footnotes      | superscript digits **4.3 pt** against 6.5 pt body, baseline ~1.6 pt higher (e.g. `GHG reductions achieved⁷`); subscript `2` in `CO₂e` is _lower_ than the baseline and is not a footnote                                  |
| Endnotes       | PDF 11–12: 19 notes in the form `n<tab>text`, wrapped lines, bullet sub-items (`• Off:`, `• Sleep:`) inside note 18, a table in the middle of PDF 12, and a 6 pt legal footer                                             |
| Element types  | prose call-outs, charts (p. 2), tables (p. 10, 12), certification badges (p. 1), lifecycle wheel, product photos and line art (decorative), endnotes                                                                      |

## 3. Assumptions

| Assumption                                                                                                                                                     | How it could break                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A table header = a connected group of dark (r+g+b < 1.2) filled rectangles, 8–70 pt tall, 30 pt+ wide, not page-sized (`pdf/tables.ts`)                        | a dark decorative band (none found: the finder returns exactly the 3 real tables on 12 pages); a table with a light header                                                                                                                    |
| Leaf rectangles = column cells; the leftmost leaf is the row-label header; a wider rectangle above narrower ones is a super-header (title)                     | merged cells with irregular layout                                                                                                                                                                                                            |
| Rows = words within 3.2 pt baseline of each other under the bar until the next bar, a line starting with “Note”, a line longer than 80 chars, or a gap > 38 pt | tall wrapped rows                                                                                                                                                                                                                             |
| Prose inside a table area (±6 pt) is excluded from prose chunks                                                                                                | prose set tight against a table                                                                                                                                                                                                               |
| Footnote marker = digit span ≤ 0.78× body size and raised ≥ max(0.8 pt, 0.12× size) after other text (`pdf/footnotes.ts`)                                      | other documents with larger superscripts; in-text numbers that are really superscripts of units (m²) are letters, not digits, so are unaffected                                                                                               |
| Endnotes: pages 11–12, notes 1–19 in increasing order; table area and the 6 pt footer are excluded                                                             | a note number that is not the next in sequence is treated as continuation text                                                                                                                                                                |
| Noted text cap: `[Note n] <endnote, max 700 chars>`                                                                                                            | a longer endnote is cut (measured: notes 5 (907 chars) and 18 (1276 chars) exceed 700; the cut keeps the opening definition, e.g. the ENERGY STAR requirement statement of note 18, and drops the later bullet definitions of Off/Sleep/Idle) |

## 4. Techniques

| Problem                                  | Fix                                                                                                                                                                                                                                                                                                                                                                    | Why it works                                                                               | Rejected                                                                                    | Cost                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| detached table values                    | **header-bar table rebuild**: `Table: Greenhouse gas emissions. Column: iMac (two ports) 256GB` / `Total product footprint: 346 kg CO2e` / `Production: 50%` / `GHG reductions achieved[^7]: ↓>20%`, one chunk per table (`kind: "table"`)                                                                                                                             | each value sits beside its label and column in one line                                    | the generic table finder (it returned 3 one-row fragments on p. 10); a vision-only approach | CPU only                                                                  |
| endnote caveats                          | **endnote linking**: markers `[^n]` become `[Note n] <text>` appended to any chunk containing them; markers removed from the body                                                                                                                                                                                                                                      | the retrieved chunk carries its own caveat                                                 | chunking endnote pages as prose (caveat detached from claim)                                | none                                                                      |
| cut tables / mixed paragraphs            | **element chunks**: tables + prose groups per page and heading, up to ~220 tokens; prose in table areas excluded                                                                                                                                                                                                                                                       | table and prose never share a chunk                                                        | sentence chunks across the page                                                             | 29 chunks vs 26 naive                                                     |
| charts                                   | **4 vision pages** (1, 2, 10, 12)                                                                                                                                                                                                                                                                                                                                      | the chart’s relation 445 − 99 = 346 and the badge call-outs become text                    | auto-triage                                                                                 | 4 Gemini calls once                                                       |
| a caveat that no marker points at        | **notes attached by table title**: an endnote whose text _starts with_ the table title (≥ 2 words) is appended to that table chunk. Endnote 10 (“…based on iMac (two ports) with **512GB** storage configuration”) is referenced only from the PDF 2 chart, so before this the page-10 table (labelled 256GB) never carried it and no answer could notice the conflict | the contradiction is now inside the retrieved chunk                                        | linking notes by page only (too many unrelated notes)                                       | none                                                                      |
| blurry matching on whole tables          | **small-to-big variant** (`rows`): one chunk per table row (`Greenhouse gas emissions (iMac (two ports) 256GB) \| Total product footprint: 346 kg CO2e`), whole table + notes read                                                                                                                                                                                     | a row matches a query sharply                                                              | —                                                                                           | measured: **no gain** over flat (§8), so it is an option, not the default |
| no context on a chunk                    | **page title in every heading path** (`Carbon Footprint > Greenhouse gas emissions`) embedded with the text                                                                                                                                                                                                                                                            | the vector knows which part of the report it is                                            | —                                                                                           | none                                                                      |
| invented / merged figures, ignored notes | **answer prompt v2**: never calculate or derive figures; keep each figure with its own label and event; when a `[Note n]` qualifies a figure state it, and if its basis differs from the label report both                                                                                                                                                             | removes the model’s own arithmetic (≈156/≈173 kg) and surfaces the 256GB vs 512GB conflict | escalating to `gpt-oss-120b` (not needed: the prompt fixed it)                              | a few prompt tokens                                                       |
| reranking                                | **none, by design**                                                                                                                                                                                                                                                                                                                                                    | the reference showed a prose-trained reranker under-ranks table chunks on this document    | a rerank pass                                                                               | `--rerank` is ignored with a note; “Try next” item below                  |

## 5. Vision pages (`usecases/uc3-imac/vision-pages.json`)

Listed: **1** cover call-outs in three columns and certification badges (`saveAsset: false`); **2** carbon emissions bar chart: 445 kg baseline, −99 kg reductions, 346 kg final (`true`); **10** greenhouse gas and configuration tables, a cross-check of the rebuild (`true`); **12** power consumption table, Off/Sleep/Idle × 100V/115V/230V, cross-check (`true`).

Skipped on purpose: **3–8** (lifecycle wheel, material photos, product shots and line art are decorative; the text carries every fact), **9** (definitions), **11** (endnotes, plain text).

## 6. Pipeline walkthrough

| Step     | Real sample                                                                                                                                                                                                                 | File                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| tables   | p. 10 → 2 tables (`Greenhouse gas emissions` 8 rows; `Configuration` `iMac (four ports) 512GB: 391 kg CO2e`); p. 12 → `Table: Power consumption for iMac (Mode). Column: 100V                                               | 115V                              | 230V`with`Sleep: 100V: 0.56W; 115V: 0.57W; 230V: 0.59W` | `pdf/tables.ts` |
| endnotes | 19 notes parsed; `18 → Energy consumption and energy efficiency values are based on the ENERGY STAR Program Requirements for Computers, including the max energy allowance for iMac…`                                       | `usecases/uc3-imac/src/chunks.ts` |
| prose    | page 7 under heading `Use`: `iMac uses 58 percent less energy than the requirement for ENERGY STAR. We design our products to be energy efficient… [Note 18] Energy consumption and energy efficiency values are based on…` | `buildElementChunks`              |
| vision   | pages 1, 2, 10, 12 → `kind: "vision"` chunks; 2, 10, 12 also saved as assets                                                                                                                                                | `usecase/vision-chunks.ts`        |
| index    | `uc3__final` = element chunks + vision chunks (29 + 4)                                                                                                                                                                      | `retrieve/searcher.ts`            |

Counts: 26 naive chunks · 13 sentence chunks (UC1 recipe) · 28 element chunks (25 prose groups + 3 tables) · 14 table-row chunks (`rows` variant) · 4 vision chunks.

## 7. Query graph

```mermaid
flowchart LR
  Q([question]) --> R[retrieve: hybrid dense + BM25, RRF]
  R --> K[keep top FINAL_K in fused order — rerank off for UC3 in every environment]
  K --> G[generate: report each figure with its context]
  G --> O([QueryResult with images from linked assets])
```

There is no rerank node. `retrieve` writes the Retrieve and the Post-process (“Rerank skipped … always off for UC3”) trace lines; `generate` cites printed pages (= PDF pages) and attaches the page images of cited vision chunks.

## 8. Ablation ladder results

Ladder: **1** naive 1000-char, dense → **2** the UC1 recipe (sentences, hybrid) → **3** element chunks, dense → **4** element chunks, hybrid → **5** elements + vision, hybrid.

_Measured offline, BM25 only, 6 scored questions (`npm run offline:bm25`):_

| Step | Technique (BM25 only)                           | hit@1 | hit@3 | hit@5 | MRR  |
| ---- | ----------------------------------------------- | ----- | ----- | ----- | ---- |
| 1    | naive 1000-char                                 | 0.50  | 0.83  | 1.00  | 0.71 |
| 2    | UC1 recipe (sentence chunks)                    | 0.67  | 1.00  | 1.00  | 0.83 |
| 4    | element chunks (tables, prose groups, endnotes) | 0.67  | 1.00  | 1.00  | 0.83 |

On a 12-page document the retrieval metric saturates: every variant finds the gold page in the top 5. The differences that matter here are **what the retrieved chunk contains** (table row with its column, claim with its endnote), which hit@k cannot see — that is why the report keeps the full final chunks and an empty verdict row per question for manual checking.

_Measured with the APIs (11 scored questions after adding S4–S8; development mode; retrieval only, `npm run uc3:eval -- --ladder --retrieval-only`):_

| Step   | Technique                                              | hit@1    | hit@3 | hit@5 | MRR                |
| ------ | ------------------------------------------------------ | -------- | ----- | ----- | ------------------ |
| 1      | naive 1000-char, dense                                 | 0.64     | 0.91  | 0.91  | 0.77               |
| 2      | UC1 recipe (sentences, hybrid)                         | 0.64     | 0.91  | 0.91  | 0.77               |
| 3      | elements, dense                                        | 0.73     | 1.00  | 1.00  | 0.85               |
| 4      | elements, hybrid                                       | **0.82** | 1.00  | 1.00  | **0.91**           |
| 5      | + vision, hybrid                                       | 0.73     | 1.00  | 1.00  | 0.83               |
| 6      | + table rows searched, whole table read (small-to-big) | 0.73     | 1.00  | 1.00  | 0.83               |
| rerank | n/a                                                    |          |       |       | always off for UC3 |

Reading it: element chunks beat the sentence recipe (0.85 → 0.91 with hybrid), and hybrid beats dense (BM25 supplies exact tokens such as `0.57W`, `20.9W`, `391 kg`). **Vision (step 5) costs a little retrieval** (0.91 → 0.83): the page-10 vision description duplicates the table and sometimes outranks it, so one question loses rank 1; it is kept because it adds the chart reading (S1) and the images. **The small-to-big row layout (step 6) scored exactly the same as the flat layout with vision (step 5)**, so it earns nothing on this 12-page document; `final` (flat) stays the default and `rows` stays available with `UC3_VARIANT=rows` (index variant `rows`). n = 11: treat 0.1 as noise.

### Answer accuracy (automatic checks)

Status of the problems found in the first run: **invented numbers** (≈156/≈173 kg) — fixed, B2 passes its `answerExcludes` check; **256GB vs 512GB conflict** — fixed (S4 passes in the full final run); S1 now only requires the two figures the question asks for (445 and 99).

Each question can define `answerContains` / `answerExcludes`; the report shows PASS/FAIL per question.

| Run                                                                             | checks passed | notes                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| naive index (prompt v2)                                                         | 7/11          | B3, S1, S2 and S4 miss required figures or the note                                                                                                       |
| rows variant, small-to-big (prompt v2)                                          | 10/11         | its S4 answer was _labelled 256 GB, but note 10 says 512 GB_; the one “fail” was the check not treating “256 GB” as “256GB” (fixed: units are normalised) |
| flat `final` variant (prompt v2)                                                | 10/11         | S4 answered only “256 GB”: the table passage did contain Note 10 but the model did not use it                                                             |
| **flat `final` variant, prompt v3 (“read every note in the passages you use”)** | **11/11**     | S4: _reported for the 256 GB configuration, but note 10 states … 512 GB_; B2 no invented figures; S1 gives 445 and 99                                     |

The row layout is not needed for the S4 fix: the stronger note instruction fixed the flat layout too, which is why flat stays the default. Retrieval for the final run: hit@1 0.73, hit@3 1.00, hit@5 1.00, MRR 0.83 (n = 11), report `reports/uc3-2026-10-22T09-01-36-final.md`. The naive and rows runs used prompt v2 and were not re-run with v3 (Groq daily token budget).

## 9. Eval results

| id  | Question                                                | Spec gold | **Verified gold (PDF = printed)** | Evidence                      | Note                                                                                         |
| --- | ------------------------------------------------------- | --------- | --------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| B1  | less energy than ENERGY STAR                            | 7         | **7**                             | `58 percent`                  | only PDF 7; the chunk carries Note 18 (tested)                                               |
| B2  | total carbon footprint, use vs manufacturing            | 10        | **2, 10**                         | `346 kg`                      | the figure is also on the PDF 2 chart page                                                   |
| B3  | stand material and recycled %                           | 1, 4      | **1, 2, 4**                       | `aluminum`                    | “100 percent recycled aluminum in the stand” also on PDF 2                                   |
| S1  | baseline emissions and reductions                       | 2         | **2**                             | `445`                         | chart page; vision chunk expected to give 445 − 99 = 346                                     |
| S2  | renewable share of manufacturing electricity + footnote | 1, 5, 11  | **1, 5, 11**                      | `20`                          | “Over 20%” p. 1 and 5; endnote 2 on p. 11                                                    |
| S3  | sleep mode at 115V                                      | 12        | **12**                            | `0.57W`                       | in the rebuilt table chunk                                                                   |
| S4  | which configuration is 346 kg based on                  | —         | **10, 11**                        | `512GB storage configuration` | label says 256GB, endnote 10 (PDF 11) says 512GB; the page-10 table chunk must carry Note 10 |
| S5  | footprint, four ports 512GB                             | —         | **10**                            | `391 kg`                      |                                                                                              |
| S6  | idle, display on, 230V                                  | —         | **12**                            | `20.9W`                       |                                                                                              |
| S7  | product use and end-of-life shares                      | —         | **10**                            | `Product use`                 |                                                                                              |
| S8  | baseline for the >20% reduction                         | —         | **2, 11**                         | `business-as-usual`           | endnote 7                                                                                    |
| R1  | iMac Pro footprint                                      | —         | —                                 | —                             | exact refusal phrase                                                                         |

Measured (final pipeline, `reports/uc3-2026-10-19T14-01-13.md`): hit@1 0.83, hit@3 1.00, hit@5 1.00, MRR 0.89; refusal exact. Answers: B1 58 percent ✔ (chunk carries Note 18); B2 346 kg, 45% product use, 50% production ✔ but the answer also computes ≈156 / ≈173 kg itself, which are not printed in the document; S1 445 kg baseline and 99 kg reduction ✔ (does not state 346); S2 over 20% + endnote 2 explanation ✔; B3 aluminum 100% recycled ✔; S3 0.57 W ✔; R1 exact refusal ✔. The 346 kg (256GB label vs endnote 10 “512GB”) inconsistency was **not** reported by any answer: the prompt’s “report each figure with its context” rule did not trigger it. Naive-index report: `reports/uc3-2026-10-21T06-49-34-naive.md` (answers also correct; hit@1 0.50).

| id  | Verdict (yours) | Notes |
| --- | --------------- | ----- |
| B1  |                 |       |
| B2  |                 |       |
| B3  |                 |       |
| S1  |                 |       |
| S2  |                 |       |
| S3  |                 |       |
| R1  |                 |       |

## 10. Cost and usage

Expected: Gemini 4 page images once (cached); Voyage ≈ 25k tokens over naive/sentence/elements/final (a few minutes at the default limits); Groq: 1 answer call per question; **no rerank calls ever**. **Escalation: none made.** Record any `gpt-oss-120b` or Flash use here with the failing question and both answers.

## 11. Failure modes and limits

- The table finder keys on **dark filled header bars**; a table without one is invisible to it (the vision pages are the safety net for p. 10 and 12).
- Endnote text is capped at 700 chars per attached note (notes 5 and 18 are longer and are cut; the other 17 fit).
- Prose groups are per page and heading; a claim split over a page break is two chunks.
- 12 pages and 6 scored questions: hit@k saturates; judge by the manual verdict rows.
- Rerank off is a measured-on-another-run decision, not a universal rule; the documented reason is that a prose-trained reranker under-ranks table chunks.

## 12. Try next

Multi-query / question decomposition (“baseline figure and reductions” as two lookups); HyDE; a corrective loop when a cited chunk lacks its endnote; `voyage-context-4`; the **rerank experiment** for UC3 only as an experiment (`rerank-2.5` on a table-aware rendering of the chunks) — not enabled today; GEP Tier 2 vision pages do not apply here.
