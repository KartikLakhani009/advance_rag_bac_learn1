# RAG learning monorepo (TypeScript)

Three independent RAG use cases, each over **one PDF**, each fixing a different way basic RAG breaks with small, specific techniques whose effect is **measured one technique at a time**. Every answer is website-ready structured data (answer, citations with printed pages, supporting image paths, trace).

| Use case                    | PDF                                                | Pages | What breaks basic RAG                                                                                                          |
| --------------------------- | -------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| **UC1** `usecases/uc1-gpo`  | U.S. GPO 2018 Annual Report                        | 82    | two-column pages, size-based chunks cut sentences, right passage ranked low, key figures in raster charts and financial tables |
| **UC2** `usecases/uc2-gep`  | World Bank Global Economic Prospects, June 2026    | 200   | damaged "Th" ligature, no knowledge of chapter/region, "SAR" vs "South Asia", table fragments outrank prose                    |
| **UC3** `usecases/uc3-imac` | Apple iMac Product Environmental Report (Oct 2024) | 12    | table values detached from their columns, caveats in endnotes, a chart says what the text does not                             |

Everything runs through APIs (Groq, Gemini, Voyage). **No Docker, no Python, no local ML models, nothing compiled at install time.**

Docs: [`docs/00-architecture.md`](docs/00-architecture.md) · [`docs/uc1-gpo-understanding.md`](docs/uc1-gpo-understanding.md) · [`docs/uc2-gep-understanding.md`](docs/uc2-gep-understanding.md) · [`docs/uc3-imac-understanding.md`](docs/uc3-imac-understanding.md)

## Setup

Requirements: Node.js 20+ (`.nvmrc` pins 20). Works on Windows, macOS and Linux.

```bash
git clone <this repo> && cd rag-learning
npm i
cp .env.example .env      # Windows: copy .env.example .env
# fill in GROQ_API_KEY, GEMINI_API_KEY, GEMINI_MODEL_VISION, VOYAGE_API_KEY
```

`GEMINI_MODEL_VISION` has no default on purpose: put a current Gemini **Flash-Lite** model ID there (check the Gemini model list; escalate to a Flash model only if eval shows a failure that docs can point at).

The three PDFs are in `data/raw/`. The pipeline reads from there.

## Run order

Chroma must be running first (every use-case script checks and tells you if it is not):

```bash
# terminal 1
npm run chroma                    # local Chroma server, data in ./.chroma

# terminal 2 — repeat for uc2 and uc3
npm run uc1:ingest -- --naive     # baseline index (naive 1000-char chunks)
npm run uc1:ingest                # final index: sentence chunks + vision chunks + assets
npm run uc1:query -- "How many depository libraries did GPO staff visit in FY 2018?" --debug
npm run uc1:eval                  # eval questions through the full pipeline → reports/uc1-<timestamp>.md
npm run uc1:eval -- --naive       # same, on the naive index
npm run uc1:eval -- --ladder      # every ablation step (needs both ingests)
```

Query flags: `--debug` (PDF pages, filters, shortlist, usage) · `--naive` · `--rerank | --no-rerank` · `--open` (open cited images).
Eval flags: `--naive`, `--ladder`, `--rerank`, `--retrieval-only`. Each question in `eval/questions.yaml` can define `answerContains` / `answerExcludes`; reports show an automatic PASS/FAIL per answer.

Other scripts:

```bash
npm run lint            # ESLint (typescript-eslint, eqeqeq, no unused)
npm run format          # Prettier (format:check in CI)
npm run typecheck        # tsc --noEmit
npm test                 # vitest: page mappings, reading order, ligature repair, footnotes, page-10 table rebuild, rerank, config, retrieval, chunking
npm run viewer           # browse what is stored in Chroma (http://localhost:5173, loopback only)
npm run offline:bm25     # BM25-only ablation per use case: no API keys, no Chroma needed
npm run uc1:eval -- --ladder --retrieval-only   # ladder scored on retrieval only: no Groq tokens (same for uc2, uc3)
sh scripts/run-evals.sh "uc3 uc1 uc2"   # naive + ladder per use case, sequentially (+ UC3 rows variant)
npm run verify:gold      # locate every eval evidence string in the extracted text and check the gold pages
```

Example output (illustrative shape; real numbers come from your run):

```
Q: What is the growth outlook for South Asia in this report?

A: Growth in South Asia is expected to soften to 6.3 percent in 2026 [1].

Citations:
  [1] p. 74 — Chapter 2: Regional Outlooks > South Asia > Outlook

Rerank: OFF (development)
Trace:
  Query: LLM read the question: region=South Asia; rewritten: "South Asia growth outlook projected 2026 EMDEs"
  Retrieve: Hybrid search over 383 heading-tagged chunks inside the filter: shortlist of 18
  Post-process: Rerank skipped (development)
  Post-process: Swapped for 3 parent sections (5 children → parents, deduped)
  Generate: 3 numbered passages → answered
```

## Development vs production

|                   | development (default)       | production                                                                                   |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `APP_ENV`         | `development`               | `production`                                                                                 |
| Rerank (UC1, UC2) | **off**, no rerank API call | **on**: Voyage `rerank-2.5-lite`, cached, rate limited, falls back to fused order on failure |
| Rerank (UC3)      | always off                  | always off                                                                                   |

Rerank resolution order: CLI flag (`--rerank` / `--no-rerank`) → `RERANK_ENABLED` (`true`/`false`) → `APP_ENV` default → use-case override (UC3 off). Every CLI run and every report states the mode.

Model escalation (answer model) is per use case through the environment, e.g. `GROQ_MODEL_ANSWER_UC2=openai/gpt-oss-120b`. Do this only when eval shows a failure you can document.

## Vision pages: how to edit

Vision runs **only** on pages listed in `usecases/<uc>/vision-pages.json` (1-based **PDF** page numbers). Unlisted pages never go to Gemini.

```json
{ "pages": [{ "page": 98, "printedPage": "76", "note": "Table 2.10 South Asia economy forecasts", "saveAsset": false }] }
```

- `saveAsset: true` also saves a PNG (figure crop when the layout shows a "FIGURE n … Source:" block, otherwise the whole page) to `data/assets/<uc>/images/` and links it to the vision chunk, so a web UI can show it.
- Out-of-range, duplicate or malformed pages fail ingestion with a message naming the file and pages.
- Results are cached by page-content hash + model + prompt version in `data/processed/vision/`. Re-running ingestion makes no API call for unchanged pages; adding a page costs one call.
- After editing, re-run `npm run <uc>:ingest`.

### GEP Tier 2 pages (optional, not enabled)

These figure blocks already have their title, summary paragraph and source notes in the text layer, and no current eval question depends on chart values. Add them with `"saveAsset": true` when chart-value questions or website images are needed (printed page = PDF − 22):

- Chapter 1: 27, 28, 31, 33, 36, 37, 38, 40, 42, 45, 48, 49, 52, 54, 57, 59, 61
- Chapter 2: 73, 74, 77, 78, 79, 82, 85, 89, 93, 97, 100
- Chapter 3: 110, 113, 114, 117, 120, 121, 122, 123, 124, 125, 127
- Chapter 4: 146, 147, 150, 152, 153, 154, 157, 159, 161, 163, 165, 168, 171, 177
- Statistical appendix country GDP tables: 187, 188, 189, 190

Skipped on purpose: cover (1), chapter dividers (23, 69, 107, 143, 185), front-matter photos and foreword (3–21, except the Executive Summary text on 19–20), Table 1.2 country classification (62), Chapter 3–4 regression and data tables (134–138), selected-topics list (192–200).

Optional extras for UC1 if eval shows a need: 12 (appropriations tables), 28 (organizational chart), 76 (wide unexpended-appropriations table), notes tables on 64, 69–72, 74, 78, 79, 81.

## Rate limits and free tiers

Every provider goes through `packages/core/src/ratelimit.ts` (sliding window, RPM and TPM) and `retry.ts` (exponential backoff with jitter, honours `Retry-After`). Every paid call is cached on disk (`data/processed/`): embeddings by text hash, vision by page hash, rerank by query + candidate IDs, query understanding by question.

| Provider | Setting                            | Free-tier note                                                                                                                                                                                                                                               |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Groq     | `GROQ_RPM=30`                      | shared key with a **daily cap of 200k tokens per model** (a full set of evals uses ~100k): answers are cached by question + exact context + model + prompt version, so unchanged re-runs are free; use `--retrieval-only` to score retrieval without Groq    |
| Gemini   | `GEMINI_RPM=10`                    | only listed pages are sent: 14 (UC1) + 11 (UC2) + 4 (UC3) pages in total                                                                                                                                                                                     |
| Voyage   | `VOYAGE_RPM=3`, `VOYAGE_TPM=10000` | very low until a payment method is on file; **a full first ingest of all three documents embeds roughly 0.45M tokens (≈ 45 minutes at 10k TPM)**. Add a payment method and raise `VOYAGE_RPM`/`VOYAGE_TPM` to cut this to minutes. Re-runs are free (cache). |

Embedding work per variant (UC2 is the big one): UC1 naive ≈ 170 chunks, sentence ≈ 85 + 14 vision; UC2 naive ≈ 705, section-aware ≈ 372, heading-tagged ≈ 372 + 11 tables; UC3 ≈ 100 chunks over four variants.

## Troubleshooting

| Symptom                                                                    | Fix                                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Chroma is not running. Start it in another terminal with: npm run chroma` | start it; `CHROMA_URL` must match (default `http://localhost:8000`)                                                         |
| `Missing required environment variable(s): …`                              | the message names every missing key; set them in `.env`                                                                     |
| `No index "final" for uc1. Run ingest first`                               | run `npm run uc1:ingest` (and `-- --naive` for the baseline)                                                                |
| `--ladder` fails opening an index                                          | the ladder needs every variant: `npm run <uc>:ingest -- --naive` and `npm run <uc>:ingest`                                  |
| HTTP 429 from a provider                                                   | handled by backoff; lower `*_RPM`; the log line names the call                                                              |
| Rerank says FAILED                                                         | the query still answered in fused order; the report flags it                                                                |
| Vision: `lists page(s) N but the PDF has only M pages`                     | fix `vision-pages.json` (1-based PDF pages)                                                                                 |
| Changed a repair/chunking rule                                             | `data/processed/` caches only paid API results, not extraction; re-run ingest. Delete `data/processed/` to force everything |
| mupdf prints `warning: ActualText…`                                        | harmless text from the GPO PDF                                                                                              |

## Repository layout

```
packages/core/src   config, errors, schemas, logger, usage, ratelimit, retry, cache, llm, vision, embeddings, prompts, answer, present, cli,
                    pdf/ (extract, pages, layout, repair, footnotes, tables, render, document, elements), text/, chunking/, retrieve/, assets/, eval/,
                    usecase/ (kit: runtime + ingest context, commands: shared query/eval entry points, assets, ask-output, vision-chunks, app)
usecases/uc{1,2,3}  src/{ingest,graph,query,eval}.ts (+ chunks.ts, UC2: structure/regions/understand/search/store, UC3: store), vision-pages.json, eval/questions.yaml
scripts/            offline-bm25.ts, verify-gold.ts, run-evals.sh, viewer/ (local Chroma viewer, 127.0.0.1 only)
data/raw            the 3 PDFs   data/processed  caches (gitignored)   data/assets/<uc>  images + manifest.json (gitignored)
reports/            generated eval reports (gitignored)   docs/  architecture + three understanding docs
```

Code conventions: use cases import the shared library as `@rag/core/src/…` (npm workspace link, no path aliases); every npm script entry point goes through `runCli` (expected failures are `UserError`s printed as one line, anything else prints the stack); environment is read only through the Zod schema in `config.ts`; `tsc` runs with `noUnusedLocals`, `noUnusedParameters` and `noImplicitOverride`.


Licence note: `mupdf` is AGPL. Fine for this learning project; a closed product needs a commercial MuPDF licence.
