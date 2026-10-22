# Architecture

## 1. What this repo is

An npm-workspaces monorepo with one shared library (`packages/core`) and three independent use cases (`usecases/uc1-gpo`, `uc2-gep`, `uc3-imac`). Each use case owns one PDF, its Chroma collections, BM25 indexes, config, assets, eval set, reports and understanding doc. Nothing is shared across documents except code.

Design rules (from the brief): runs anywhere on modest hardware; right-sized models; respect free-tier limits; **fix the text before chunking it**; measure every technique; explain the why.

## 2. Stack and why

| Concern       | Choice                                                                                | Why                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Language      | TypeScript strict, Node 20+, `tsx` (no build)                                         | `git clone → npm i → npm run …` everywhere; `typecheck` = `tsc --noEmit`                             |
| Monorepo      | npm workspaces                                                                        | no extra tooling                                                                                     |
| Orchestration | LangGraph.js, one `StateGraph` per use case                                           | each query is a small, explicit graph whose nodes write the trace                                    |
| Text LLM      | Groq `openai/gpt-oss-20b` (`@langchain/groq`)                                         | smallest model that does rewrite + grounded 1–3 sentence answers; 120b is an escalation per use case |
| Vision        | Gemini Flash-Lite (`@google/genai`), listed pages only                                | charts/tables are the only content text extraction cannot recover                                    |
| Embeddings    | Voyage `voyage-4-lite` (`voyageai`)                                                   | no local models; document vs query `inputType`                                                       |
| Rerank        | Voyage `rerank-2.5-lite`, **production only**                                         | the reference run showed rerank was a major gain for UC1/UC2, but dev must not spend calls           |
| Dense store   | Chroma local server (`chromadb` npm, `npx chroma run`)                                | no Docker; metadata `where` filters                                                                  |
| BM25          | MiniSearch, index persisted as JSON                                                   | pure JS                                                                                              |
| Fusion        | Reciprocal Rank Fusion in our code                                                    | ranks only, no score normalisation                                                                   |
| PDF engine    | `mupdf` (official WASM)                                                               | font name/size/flags, bboxes, drawings, image positions, page and region rendering                   |
| Sentences     | `Intl.Segmenter` + abbreviation/marker guards                                         | built into Node                                                                                      |
| Tokens        | `js-tiktoken` (cl100k, approximate is fine)                                           | chunk sizing and TPM budgeting                                                                       |
| Validation    | Zod everywhere: env, configs, elements, chunks, assets, LLM JSON, eval files, results | one failure message names every bad key                                                              |
| Tests         | Vitest                                                                                |                                                                                                      |

**Licence.** `mupdf` is AGPL-3.0. That is fine for a learning project. A closed-source product needs a commercial MuPDF licence (Artifex) or a different PDF engine.

### Python reference → TypeScript mapping

| Reference (Python)                | TypeScript here                                                               |
| --------------------------------- | ----------------------------------------------------------------------------- |
| PyMuPDF text, drawings, rendering | `mupdf` npm (WASM): `StructuredText.walk`, `Device.fillPath`, `Page.toPixmap` |
| Qdrant BM25 + RRF                 | MiniSearch + RRF in code; Chroma for dense                                    |
| Local MiniLM cross-encoder        | Voyage rerank API, production only (no local models, by design)               |
| Sentence splitter                 | `Intl.Segmenter` + abbreviation guard                                         |
| Token counting                    | `js-tiktoken`                                                                 |
| bge-small local embeddings        | Voyage `voyage-4-lite`                                                        |

## 3. Data flow

```
data/raw/*.pdf
  │  pdf/extract.ts      mupdf structured text → spans (font, size, bold, bbox, baseline), image boxes, filled rectangles
  ▼
  │  pdf/layout.ts       header/footer removal (repeated at the same position) → band-based two-column reading order → drop caps
  │  pdf/pages.ts        printed page number from the header/footer band, cross-checked with the offset table
  │  pdf/footnotes.ts    small + raised digit span right after a word → [^n]
  ▼
  │  pdf/elements.ts     lines → paragraphs; hyphen joins; NFKC; "Th" ligature repair (needs the whole-document vocabulary)
  ▼  clean, typed, page-tagged Elements
  ├─ UC1 chunking/sentence.ts  sentence windows ~450 tokens, 60 overlap            ─┐
  ├─ UC2 structure.ts (fonts) → chunking/hierarchy.ts parents ~900 / children ~280 ├─ + vision chunks (listed pages only)
  └─ UC3 pdf/tables.ts header-bar rebuild + prose groups + endnote links            ─┘
  ▼
  │  retrieve/searcher.ts   Chroma (dense) + MiniSearch (BM25), same filter applied to both
  ▼
  LangGraph query graph → rerank (prod only) → [parent swap] → grounded answer → QueryResult
```

Processed data lives in `data/processed/<uc>/` (indexes, parents), `data/processed/{embeddings,vision,rerank}/` (paid-call caches). Extraction itself is recomputed on every run (it takes seconds and is deterministic), so changing a repair rule never needs a cache purge.

## 4. Page numbering

All page numbers in code, configs and eval files are **1-based PDF pages**. Answers cite **printed** pages. Every element and chunk stores `page`/`pageEnd` (PDF) and `printedPage`/`printedPageEnd`.

| Document | Mapping                                                                                    | Test            |
| -------- | ------------------------------------------------------------------------------------------ | --------------- |
| GEP      | front matter roman (PDF 19–20 = xvii–xviii); from Chapter 1 on PDF = printed + 22          | `pages.test.ts` |
| GPO      | annual report part PDF = printed + 2; financial section (starts PDF 33) PDF = printed + 31 | `pages.test.ts` |
| iMac     | PDF = printed                                                                              | `pages.test.ts` |

`detectPrintedPage` reads the number from a corner of the header/footer band. It is cross-checked against the offset table and **the table wins** when they disagree or when the page prints no number (the whole GPO financial section prints none; iMac page 1 has a stray "6" in the band). Detection is therefore a consistency check, not the source of truth. `layout.test.ts` asserts detected values for sample pages.

## 5. Zod schemas (`packages/core/src/schemas.ts`)

`Element`, `Chunk`, `ParentChunk`, `Asset`/`AssetManifest`, `VisionPagesConfig`, `EvalQuestion`, `QueryResult` (with `Citation`, `ResultImage`, `RankedChunk`), `Metrics`, `QueryUnderstanding` (UC2's one LLM JSON). Env is validated by `EnvSchema` in `config.ts`; blank values in `.env` count as unset so `.env.example` copies cleanly.

Chunk kinds: `naive`, `sentence`, `text` (UC3 prose), `body`, `box`, `executive_summary`, `table`, `vision`; noise kinds `table_fragment`, `front_matter`, `references` are never indexed or searched.

## 6. Retrieval design

- **Dense**: Voyage embeddings in a Chroma collection `<uc>__<variant>` (cosine). Embedded text = `headingPath + "\n" + text` when a heading path exists; the stored text is unchanged.
- **BM25**: MiniSearch over the same embedded text; index persisted as JSON per variant.
- **Hybrid**: `SHORTLIST_K` from each, fused by RRF: `score = Σ 1/(RRF_K + rank)`, rank from 0, `RRF_K=2` default (try 60 in the ladder). Ranks only.
- **Filters**: one `Filter` object (`region`, `chapter`, `kinds`, `excludeKinds`) is turned into a Chroma `where` (`toChromaWhere`) and a MiniSearch predicate (`matchesFilter`); `retrieval.test.ts` asserts both give the same set.
- **Rerank**: `retrieve/rerank.ts`. Candidates are the fused list; cache key = hash of (query, sorted candidate IDs, model); calls go through the limiter with estimated tokens; on failure after retries the fused order is returned with `used: false` and flagged in the CLI and report. A query never crashes because of rerank. Unit-tested against a mocked Voyage client (`rerank.test.ts`).
- **Parent swap (UC2)**: `retrieve/parents.ts` dedupes children by parent in rank order, max 3. A chunk without `parentId` (table chunk) is its own parent.

## 7. Development vs production

`APP_ENV=development` (default) turns rerank off; `production` turns it on. `RERANK_ENABLED` overrides `APP_ENV`; `--rerank/--no-rerank` overrides both for one run; UC3 overrides all (always off). `resolveRerank()` in `config.ts` is the single implementation (tested). Reports and the CLI print `Rerank: OFF (development)` / `Rerank: ON (Voyage rerank-2.5-lite)`.

## 8. Vision page config and asset manifest

`vision-pages.json` (Zod `VisionPagesConfig`) is the only way a page reaches Gemini. Each listed page: render ~110 DPI PNG with mupdf, send it with that page's extracted text and the versioned prompt, store the text as its own chunk (`kind: "vision"`, or `"table"` in UC2), cache by `(sha256 PNG, sha256 page text, model, prompt version)`.

`data/assets/<uc>/manifest.json`:

```json
{ "assets": [ { "id": "uc3-p2", "type": "figure|page|photo", "file": "images/uc3-p2.png", "page": 2, "printedPage": "2",
                "bbox": {"x0":…}, "caption": "…", "decorative": false, "sha256": "…", "chunkIds": ["uc3-v2"] } ] }
```

Paths are relative POSIX; absolute paths are produced only when printing. Vision chunks link their page's asset; captioned photos link to the nearest prose chunk; decorative images are saved but never linked. Figure crops use the "FIGURE n … Source:" block when the layout shows one, else the whole page.

## 9. `QueryResult` contract

```ts
{ question, answer, status: "answered" | "not_found",
  citations: [{ n, chunkId, page, pageEnd, printedPage, printedPageEnd, headingPath }],
  images: [{ assetId, type, caption, page, printedPage, file, absolutePath }],   // linked to cited chunks, max 4
  trace: [{ stage: "Query" | "Retrieve" | "Post-process" | "Generate", note }],
  debug?: { filters, rewrittenQuery, shortlist, final, rerankUsed, rerankModel, usage } }
```

`QueryResult.parse` validates every result before it is returned. The answer prompt labels passages with **printed** pages; refusals use the exact phrase `I could not find this in the document.` and get no citations or images.

## 10. Caching

| What                    | Key                                                     | Where                            |
| ----------------------- | ------------------------------------------------------- | -------------------------------- |
| Embeddings              | model + input type + sha256(text); base64 Float32       | `data/processed/embeddings/`     |
| Vision                  | page PNG hash + page text hash + model + prompt version | `data/processed/vision/<uc>/`    |
| Rerank                  | query + sorted candidate IDs + model                    | `data/processed/rerank/`         |
| UC2 query understanding | question + model + prompt version                       | `data/processed/uc2/understand/` |

Never call an API twice for the same input. Failed rerank calls are not cached.

## 11. Rate limiting and retries

`RateLimiter` (sliding window, RPM + TPM) wraps Groq (`GROQ_RPM`), Gemini (`GEMINI_RPM`), Voyage embeddings and rerank (`VOYAGE_RPM`, `VOYAGE_TPM`, token estimates from `js-tiktoken`). Embedding batches are token-aware (≤ 40% of TPM per request, ≤128 inputs). `withRetry` does exponential backoff with jitter on 429/5xx/network errors and honours `Retry-After`. Eval runs questions one at a time.

## 12. Model escalation policy

Defaults: gpt-oss-20b (rewrite + answer), Flash-Lite (vision), voyage-4-lite, rerank-2.5-lite. A bigger model is used **only** when eval shows a specific failure, and the use-case understanding doc must show that failure (question, what the small model answered, what the bigger one answered, token cost). Answer model per use case: `GROQ_MODEL_ANSWER_UC1/UC2/UC3`. Vision: `GEMINI_MODEL_VISION`. Embedding/rerank: `VOYAGE_EMBED_MODEL`, `VOYAGE_RERANK_MODEL`. No escalation has been needed so far (see each doc's cost section).

## 13. Cross-platform rules

Paths via `node:path`; manifests store relative POSIX paths; each npm script is one command (anything longer is a TS script); no shell syntax, no local model downloads or inference. Repo root is derived from `import.meta.url`, so scripts work from any working directory. Every use-case script checks Chroma first and prints `Chroma is not running. Start it in another terminal with: npm run chroma`.

## 14. Code structure (shared vs per use case)

Each use case contributes only what is specific to its document: `chunks.ts` (how the PDF becomes chunks), `graph.ts` (its LangGraph nodes), and thin `ingest/query/eval` entry points. Everything else is shared in `packages/core/src/usecase/`:

| Module             | Responsibility                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kit.ts`           | `createRuntime` (Chroma check → validated env → clients, rerank decision, answer model per use case), `createIngestContext`, `rerankStage`              |
| `commands.ts`      | `runQueryCommand` / `runEvalCommand`: argument parsing, runtime, presentation or report; a use case supplies only `setup()` (its index, app and ladder) |
| `ask-output.ts`    | `toAskOutput`: graph state → validated `QueryResult` + the ranked list the eval scores                                                                  |
| `assets.ts`        | `linkPhotos`, `syncAssetIds`                                                                                                                            |
| `vision-chunks.ts` | one chunk (and optional asset) per page listed in `vision-pages.json`                                                                                   |

Errors: `UserError` (and `ChromaDownError`) are expected, user-fixable failures; `runCli` prints their message only and exits 1. Config: `EnvSchema` is the only place environment variables are read (including `GROQ_MODEL_ANSWER_UC1/2/3` and `UC3_VARIANT`). The answer cache (`data/processed/answers/`) is keyed by question, exact context, model and prompt version, so an unchanged re-run costs no Groq tokens.
