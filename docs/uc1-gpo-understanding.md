# UC1 — GPO Annual Report 2018 (plain text, two columns)

`data/raw/GPO-Anual-report.pdf` · 82 pages · pipeline: extraction + repair → **sentence chunks** + vision chunks → hybrid → rerank (production only) → grounded answer.

> Status of numbers: _measured offline_ = `npm run offline:bm25` / `verify:gold` / `npm test`; _measured with the APIs_ = `uc1:eval` and `uc1:eval -- --ladder` in development mode. Open item: the **production run with rerank** (`APP_ENV=production` or `--rerank`).

## 1. What breaks

| Failure of basic RAG                                                 | Real example from this PDF                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Size-based chunks cut sentences.**                                 | 1000-char naive chunks: only **5 of 170** end on a sentence boundary. A chunk on PDF p. 5 ends `…GPO’s facilities personnel undertook a major renovation project in FY 2` and the next begins `SCM). As part of a sustained effort…`.                                                                                                                                                |
| **Running furniture pollutes chunks.**                               | Every page starts with `2 0 1 8 A N N U A L R E P O R T                                                                                                                                                                                                                                                                                                                              | U . S . G O V E R N M E N T P U B L I S H I N G O F F I C E`; in the naive text it is glued onto the first sentence of the page (`…O F F I C E of logistics, distribution, warehousing…`). |
| **Drop caps scramble the first sentence.**                           | PDF p. 7 opens with a 60 pt “T” in its own block; the raw text reads `he U.S. Government Publishing Office (GPO)…` and the “T” appears pages of text later (`Tprocuring`).                                                                                                                                                                                                           |
| **Two-column pages.**                                                | Pages mix a left column, a right column and full-width captions/pull-quotes (p. 6: a photo caption `GPO employees producing Trusted Traveler Program cards…` sits between the columns). mupdf’s block order happens to be mostly right on p. 6, but nothing guarantees it; we make the order explicit and test it.                                                                   |
| **The right passage is found but ranked low; the model fills gaps.** | Several pages state the same figure (802,834 copies of 4,211 titles is on PDF pp. 5, 15 and 19), so dense similarity alone returns near-duplicates with no way to pick the right one; unsupported questions (FY 2020 revenue) invite memory answers. Measured effect of dense/hybrid on this small question set: see §8 (saturated); rerank is production-only and not yet measured. |
| **Key figures sit in raster charts and financial tables.**           | MD&A charts (receivables, capital investments, on-time delivery, passports produced) and the financial statements are drawings or wide tables. Text extraction yields a bag of numbers without labels (`Net Income $ 52,624 $ 58,876 Less: Passport Capital Projects Reserve (28,745)…`). Vision pages turn these into one `Row                                                      | column: value` line per row.                                                                                                                                                               |

## 2. Document anatomy

| Aspect                        | Observation (from span dumps of the real file)                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Annual-report part (PDF 2–29) | body `ITCGaramondStd-Lt` **9.8 pt**; photo captions `HelveticaNeueLTStd-Roman` 8.3 pt; headings `HelveticaNeueLTStd-Md`; two columns with left margin x=72/36 and right column x≈336 on a 612 pt page, full-width captions and banners |
| Financial section (PDF 33–82) | `TimesNewRomanPSMT` **12 pt**, `ArialMT` 10 pt, `Arial-BoldMT` headings 11–12 pt, `Calibri` chart labels, section title strip `Section I: Management Discussion and Analysis (Unaudited)` at y≈34                                      |
| Page furniture                | header `2 0 1 8 A N N U A L R E P O R T                                                                                                                                                                                                | U . S . G O V E R N M E N T …` (6 pt, letter-spaced, x≈36 on one side and x≈328 on the other); page numbers 8 pt in a corner |
| Page numbering                | annual-report part PDF = printed + 2; the financial section restarts numbering (PDF = printed + 31, printed 11 = PDF 42) **and prints no number at all** on most pages — the offset table is the source of truth                       |
| Element types                 | prose, photo captions, pull-quotes, infographic label/value pairs (p. 14), financial tables, charts (MD&A p. 9–17 printed), org chart (p. 28), cover pages (1, 30–32)                                                                  |
| Damaged text                  | no ligature damage found in this file; hyphenation across line breaks is present; drop caps (p. 7)                                                                                                                                     |

## 3. Assumptions

| Assumption                                                                                                                              | Where                      | How it could break                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page centre splits the columns; a block ≥ 55% of the page width (or crossing the centre by ≥ 12%) is “wide”                             | `layout.ts` `readingOrder` | a page with three columns, or a narrow centred sidebar, would be split wrongly                                                                                                       |
| Furniture = text in the top/bottom 9% of the page repeated (same text with digits masked, same y bucket) on ≥ 10% of pages (min 3)      | `findRepeatedFurniture`    | a repeated legitimate line in the band is dropped; a furniture line that varies per page survives (p. 26/28 keep the 14 pt `U . S . G O V E R N M E N T …` section title on purpose) |
| Printed number = a pure number/roman numeral in a corner of the band; cross-checked with the offset table, table wins                   | `pages.ts`                 | a stray numeral in the band; the offsets break if pages are inserted                                                                                                                 |
| Drop cap = lone letter ≥ 3× the median font size, joined to the topmost lower-case line to its right                                    | `mergeDropCaps`            | a big decorative letter that is not a drop cap; a drop cap followed by an upper-case word                                                                                            |
| A paragraph breaks on block change, style change, gap > 0.6 × font size, or an indented first line after a full stop                    | `toParagraphs`             | tables and infographics become many short “paragraphs” (acceptable: vision pages cover them)                                                                                         |
| A paragraph that ends without terminal punctuation and is followed by a lower-case paragraph is one sentence (column/page continuation) | `chunking/flow.ts`         | a heading followed by a lower-case caption                                                                                                                                           |

## 4. Techniques

| Problem                             | Fix                                                                                                                                       | Why it works                                                                         | Rejected                                        | Cost                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------- |
| mixed columns, furniture, drop caps | explicit band-based reading order + furniture removal + drop-cap merge                                                                    | chunking clean text matters more than any retrieval trick                            | trusting mupdf block order                      | seconds of CPU, zero API                           |
| cut sentences                       | **sentence chunks**: whole sentences only, ~450 tokens, ~60-token overlap carried from the end of the previous chunk, page ranges tracked | a fact near a boundary appears whole in at least one chunk; no chunk starts mid-word | 1000-char windows; fixed overlap in characters  | 85 chunks (vs 170 naive) → half the embedding cost |
| ranking                             | hybrid: dense + BM25 fused by RRF (`RRF_K=2`)                                                                                             | exact tokens (“802,834”, “govinfo”) and meaning both count                           | score normalisation                             | BM25 is free; one query embedding                  |
| right passage low, gap-filling      | **rerank** (Voyage `rerank-2.5-lite`) in production; strict grounded prompt; exact refusal phrase                                         | a cross-encoder reads query and passage together                                     | local cross-encoder (no local models by design) | one rerank call per uncached query                 |
| charts and financial tables         | 14 **vision pages** → one chunk each, linked to saved PNG assets                                                                          | the model transcribes label/value/unit; text layer cannot                            | OCR, auto-triage of pages                       | 14 Gemini calls once (cached)                      |

## 5. Vision pages (`usecases/uc1-gpo/vision-pages.json`)

Listed (PDF → printed): **14 → 12** infographic “GPO By the Numbers”; **26, 27 → 24, 25** financial summary tables; **40, 41, 42, 43 → 9, 10, 11, 12** MD&A charts (accounts receivable, capital investments, deferred revenues + workers’ comp liability, operating revenues); **45, 46, 47, 48 → 14–17** MD&A charts (on-time delivery of Congressional Record and procured printing, FDsys searches, FDsys/govinfo retrievals, passports produced, smartcards); **58, 59, 60 → 27, 28, 29** balance sheet, statement of revenues/expenses, cash flows. `saveAsset: true` for the infographic and all charts (website images), false for the tables.

Skipped on purpose: covers (1, 30, 31, 32); photo pages 3–25 except 12 and 14 (decorative photos; captions are in the text layer); letters (52, 56); abbreviations (82). Optional later, only if eval shows a need: 12 (appropriations tables), 28 (organizational chart), 76 (wide unexpended-appropriations table), notes tables on 64, 69–72, 74, 78, 79, 81.

## 6. Pipeline walkthrough

| Step                | Input → output                                                                                                  | File                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| extract             | PDF page → lines/spans with font, size, bbox, baseline; image boxes; filled rects                               | `pdf/extract.ts`                        |
| furniture + order   | 82 pages → header lines removed; lines in band order; drop cap `T` + `he U.S. …` → `The U.S. …`                 | `pdf/layout.ts`                         |
| paragraphs + repair | lines → `Element`s; hyphen joins; NFKC                                                                          | `pdf/elements.ts`, `pdf/repair.ts`      |
| sentence stream     | paragraphs → sentence units with the page where each starts; a sentence cut by a column/page break is re-joined | `chunking/flow.ts`, `text/sentences.ts` |
| chunks              | units → ~450-token windows, 60-token overlap                                                                    | `chunking/sentence.ts`                  |
| vision              | 14 listed pages → PNG @110 DPI + page text → Gemini → `kind: "vision"` chunk (+ asset)                          | `usecase/vision-chunks.ts`              |
| index               | chunks → Chroma `uc1__final`, MiniSearch JSON, `chunks.json`                                                    | `retrieve/searcher.ts`                  |

Real sample (chunk `uc1-s-2`, PDF 5–6, printed 3–4): `Those FDLP Academy programs served more than 10,000 participants in FY 2018. GPO … distributed 802,834 copies of 4,211 titles to depository libraries nationwide in FY 2018, …` — whole sentences, starts on a sentence boundary, pages recorded as `page: 5, pageEnd: 6, printedPage: "3", printedPageEnd: "4"`.

## 7. Query graph

```mermaid
flowchart LR
  S([question]) --> R[retrieve: hybrid dense + BM25, RRF, SHORTLIST_K each]
  R --> K{rerank enabled?}
  K -- production / --rerank --> V[rerank: Voyage, cached, rate limited]
  K -- development --> T[keep top FINAL_K in fused order]
  V -. API failure .-> T
  V --> G[generate: grounded answer, printed-page citations]
  T --> G
  G --> Q([QueryResult: answer, citations, images, trace])
```

`retrieve` writes the Retrieve trace line; `rerank` (a node that is a no-op in development) writes `Rerank skipped (development)` or the rerank summary and records `rerankUsed`; `generate` numbers the passages with printed pages and validates the `QueryResult`. No query understanding: the questions are plain and the document has no chapter/region structure to filter on.

## 8. Ablation ladder results

Ladder: **A** naive 1000-char, dense → **B** sentence chunks, dense → **C** + hybrid → **D** + vision chunks → **E** + rerank (production or `--rerank`; otherwise “skipped”).

Reference result on this document (from the brief): sentence chunks were the biggest gain; hybrid alone did not help; rerank did.

_Measured offline, BM25 only (4 scored questions, `npm run offline:bm25`):_

| Variant                  | hit@1 | hit@3 | hit@5 | MRR  |
| ------------------------ | ----- | ----- | ----- | ---- |
| A naive 1000-char (BM25) | 0.50  | 0.75  | 0.75  | 0.63 |
| B sentence chunks (BM25) | 0.75  | 0.75  | 1.00  | 0.81 |

Chunking alone moves MRR 0.63 → 0.81 and hit@5 0.75 → 1.00 with the same retriever. With n = 4, treat differences under ~0.1 as noise; this is a direction, not a result.

_Measured with the APIs (Voyage `voyage-4-lite` dense, 4 scored questions, `npm run uc1:eval -- --ladder`, development mode):_

| Step | Technique                                       | hit@1 | hit@3 | hit@5 | MRR  | production run with rerank |
| ---- | ----------------------------------------------- | ----- | ----- | ----- | ---- | -------------------------- |
| A    | naive 1000-char, dense                          | 1.00  | 1.00  | 1.00  | 1.00 |                            |
| B    | sentence, dense                                 | 0.75  | 1.00  | 1.00  | 0.88 |                            |
| C    | + hybrid                                        | 1.00  | 1.00  | 1.00  | 1.00 |                            |
| D    | + vision                                        | 1.00  | 1.00  | 1.00  | 1.00 |                            |
| E    | + rerank (Voyage `rerank-2.5-lite`, `--rerank`) | 1.00  | 1.00  | 1.00  | 1.00 | measured, retrieval only   |

Reading it honestly: with 4 questions the metric **saturates** (even the naive index finds a hit in the top 5 every time), so hit@k cannot show the sentence-chunk gain the reference run reported. Differences of 0.25 on n = 4 are one question. What the metric misses shows up in the **answers**: on the naive index B2 answered _“fully deployed when it moved out of beta in **December 2017**”_ (wrong date, from a chunk cut mid-sentence), on the final index it answered _December 2018_; B3 on both reported “$375.7 million” (the revenue figure) instead of “more than $375 million”. Hybrid (C) restored hit@1 = 1.00 that dense-only sentence chunks (B) lost on one question. Vision chunks (D) did not change retrieval metrics because no eval question needs a chart value; they are there for the website images and chart questions. **Rerank (E) measured with `--rerank --retrieval-only`: 1.00 on every metric, i.e. no change** — the metric is already saturated at step A, so this set cannot show a rerank gain (the reference run saw one on a harder question set). Answers with rerank on are not re-measured yet (Groq daily token cap).

**Rerank implementation note:** the first rerank run fell back to the plain order on every question (HTTP 429): UC1 sends ~40 candidates of ~450 tokens, about 18k tokens in one request, above Voyage's free-tier 10k tokens/minute, so the request could never succeed. `rerank()` now sends only the best-ranked candidates that fit 60% of `VOYAGE_TPM` (fewer candidates on the free tier, all of them on a paid tier) and reports `Reranked N of M candidates` in the trace.

### Answer accuracy (automatic checks, `answerContains` / `answerExcludes` per question)

| Run                                                              | checks passed | detail                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| naive index (prompt v2, re-run 2026-10-22)                       | 3/4           | B2 said _December 2017_ (from a chunk cut mid-sentence); B3 reported the $375.7M revenue figure as procurement                                                                                                                                                                                                    |
| final pipeline (prompt v3, `reports/uc1-2026-10-22T09-03-12.md`) | **4/4**       | B2 _govinfo … fully deployed and FDsys retired in December 2018_ (still folds the FY 2018 deployment and the December 2018 retirement into one clause; the check only forbids the wrong year), B3 _more than $375 million … the “revenues from procured printing” figure is $375.7 million_ (correctly separated) |

Earlier problem “B2 and B3 blend two nearby figures”: **fixed by prompt v2** (keep each figure with its own label and event); the residual B2 imprecision is noted above.

## 9. Eval results

Questions (`usecases/uc1-gpo/eval/questions.yaml`) and **confirmed gold pages** (`npm run verify:gold`, evidence located in the extracted text):

| id  | Question                                | Spec gold     | **Verified gold (PDF)** | Evidence  | Note                                                                                                         |
| --- | --------------------------------------- | ------------- | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| B1  | depository libraries visited in FY 2018 | 21 (verify)   | **5, 21**               | `166`     | “166 depository libraries in 25 states” on both pages                                                        |
| B2  | system that replaced FDsys, when        | 9–10 (verify) | **4, 8, 10, 22**        | `govinfo` | page 9 does not carry the statement; PDF 4 (Director’s message) and 22 do                                    |
| B3  | printing procured on behalf of agencies | verify        | **5, 14**               | `375`     | “more than $375 million worth of printing…” (p. 5); “Revenues from procured printing $375.7 million” (p. 14) |
| S1  | copies of how many titles               | 5             | **5, 15, 19**           | `802,834` | same statement on three pages                                                                                |
| R1  | FY 2020 revenue                         | —             | —                       | —         | refusal: exact phrase `I could not find this in the document.`                                               |

Measured (final pipeline, development mode, `reports/uc1-2026-10-19T13-34-14.md`): hit@1/3/5 = 1.00, MRR 1.00, refusal phrase exact. Answers: B1 166 ✔; B2 _govinfo … fully deployed in December 2018_ (merges FY 2018 deployment with the December 2018 FDsys retirement); B3 _$375.7 million_ (the infographic revenue figure; the text says “more than $375 million”); S1 802,834 copies of 4,211 titles ✔; R1 exact refusal ✔. Naive-index answers are in `reports/uc1-2026-10-21T06-53-12-naive.md` (B2 wrongly says December 2017).

| id  | Verdict (yours) | Notes |
| --- | --------------- | ----- |
| B1  |                 |       |
| B2  |                 |       |
| B3  |                 |       |
| S1  |                 |       |
| R1  |                 |       |

## 10. Cost and usage

Expected (no escalation needed so far): Gemini Flash-Lite: 14 page images once (cached); Voyage embeddings ≈ 90k tokens for naive + sentence + vision variants (≈ 9 minutes at the default `VOYAGE_TPM=10000`, free re-runs); Groq `gpt-oss-20b`: 1 answer call per question, ~1.5k input tokens; rerank (production) ≈ 40 candidates × ~450 tokens per uncached query. Measured totals per model and cache hits are written at the bottom of every report. **Escalation to `gpt-oss-120b` / Flash: none made;** if eval fails for a reason that a bigger model fixes, record question, small-model answer, big-model answer and tokens here.

## 11. Failure modes and limits

- Thresholds tuned to this PDF: 55% “wide” block width, 9% header/footer band, 10% furniture share, 3× drop-cap size, `0.6×` paragraph gap. They would not transfer to a three-column layout.
- Sentence chunk boundaries: **52 of 85 (61%)** chunks end on terminal punctuation; the rest end on headings, captions or table rows that have no full stop (they are still unit boundaries, not mid-sentence cuts). Naive: 5 of 170.
- The financial section prints no page numbers, so printed pages there come purely from the `+31` offset.
- Photo pages and cover pages add little text; vision is deliberately not run on them.
- Vision output is a model transcription: wrong numbers are possible; the `saveAsset` image lets a human check.

## 12. Try next

Multi-query and HyDE for the “same figure on three pages” case; question decomposition for “how many copies of how many titles”; a corrective-RAG loop (retry with a rewritten query when the answer is `not_found` but the shortlist looks relevant); `voyage-context-4` for contextualised chunks; add p. 12/28/76 and the notes tables as vision pages if eval needs them; reranker experiment with `rerank-2.5` instead of `-lite`.
