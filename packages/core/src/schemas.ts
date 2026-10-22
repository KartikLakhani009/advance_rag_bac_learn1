import { z } from "zod";

/** Where in the PDF something lives. page = 1-based PDF page; printedPage = what the header/footer says. */
export const BBox = z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() });
export type BBox = z.infer<typeof BBox>;

export const ChunkKind = z.enum([
  "naive",
  "text",
  "sentence",
  "body",
  "box",
  "executive_summary",
  "table",
  "table_row",
  "vision",
  "table_fragment",
  "front_matter",
  "references",
  "endnote",
]);
export type ChunkKind = z.infer<typeof ChunkKind>;

/** Kinds that never enter the search index (noise). */
export const NOISE_KINDS: ChunkKind[] = ["table_fragment", "front_matter", "references"];

export const ElementKind = z.enum(["heading", "paragraph", "table", "caption", "small", "endnote"]);

/** A typed piece of the document after layout + repair: a paragraph, heading, table, caption… */
export const Element = z.object({
  id: z.string(),
  page: z.number().int().positive(),
  printedPage: z.string().optional(),
  kind: ElementKind,
  text: z.string(),
  font: z.string().optional(),
  size: z.number().optional(),
  bold: z.boolean().optional(),
  bbox: BBox.optional(),
  column: z.union([z.literal(0), z.literal(1), z.literal("wide")]).optional(),
});
export type Element = z.infer<typeof Element>;

export const ChunkMeta = z.object({
  chapter: z.object({ number: z.number().int(), title: z.string() }).optional(),
  region: z.string().optional(),
  box: z.string().optional(),
  headingPath: z.string().optional(),
  parentId: z.string().optional(),
  noteCount: z.number().int().optional(),
});

export const Chunk = z.object({
  id: z.string(),
  kind: ChunkKind,
  text: z.string(),
  page: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
  printedPage: z.string(),
  printedPageEnd: z.string(),
  headingPath: z.string().optional(),
  chapter: z.number().int().optional(),
  chapterTitle: z.string().optional(),
  region: z.string().optional(),
  box: z.string().optional(),
  parentId: z.string().optional(),
  assetIds: z.array(z.string()).default([]),
  tokens: z.number().int().optional(),
  endsOnSentence: z.boolean().optional(),
});
export type Chunk = z.infer<typeof Chunk>;

export const ParentChunk = Chunk.extend({ childIds: z.array(z.string()).default([]) });
export type ParentChunk = z.infer<typeof ParentChunk>;

export const AssetType = z.enum(["page", "figure", "photo"]);
export const Asset = z.object({
  id: z.string(),
  type: AssetType,
  file: z.string().describe("relative POSIX path from data/assets/<uc>/"),
  page: z.number().int().positive(),
  printedPage: z.string(),
  bbox: BBox.optional(),
  caption: z.string().default(""),
  decorative: z.boolean().default(false),
  sha256: z.string(),
  chunkIds: z.array(z.string()).default([]),
});
export type Asset = z.infer<typeof Asset>;

export const AssetManifest = z.object({ assets: z.array(Asset) });
export type AssetManifest = z.infer<typeof AssetManifest>;

export const VisionPagesConfig = z.object({
  pages: z.array(
    z.object({
      page: z.number().int().positive(),
      printedPage: z.string().optional(),
      note: z.string().optional(),
      saveAsset: z.boolean(),
    }),
  ),
});
export type VisionPagesConfig = z.infer<typeof VisionPagesConfig>;

export const QuestionType = z.enum(["basic", "stress", "refusal"]);
export const EvalQuestion = z.object({
  id: z.string(),
  question: z.string(),
  expected: z.string(),
  goldPages: z.array(z.number().int().positive()).default([]),
  evidence: z.string().optional(),
  type: QuestionType,
  /** every entry must appear in the answer (case/space/hyphen-insensitive); "a|b" accepts either */
  answerContains: z.array(z.string()).default([]),
  /** none of these may appear in the answer (catches invented or conflated figures) */
  answerExcludes: z.array(z.string()).default([]),
  /** free text: how the gold pages were verified */
  note: z.string().optional(),
});
export type EvalQuestion = z.infer<typeof EvalQuestion>;
export const EvalQuestionFile = z.object({ questions: z.array(EvalQuestion) });

export const Citation = z.object({
  n: z.number().int(),
  chunkId: z.string(),
  page: z.number().int(),
  pageEnd: z.number().int(),
  printedPage: z.string(),
  printedPageEnd: z.string(),
  headingPath: z.string().optional(),
});
export type Citation = z.infer<typeof Citation>;

export const ResultImage = z.object({
  assetId: z.string(),
  type: AssetType,
  caption: z.string(),
  page: z.number().int(),
  printedPage: z.string(),
  file: z.string(),
  absolutePath: z.string(),
});

export const TraceStage = z.enum(["Query", "Retrieve", "Post-process", "Generate"]);

export const RankedChunk = z.object({
  chunkId: z.string(),
  kind: ChunkKind,
  page: z.number().int(),
  pageEnd: z.number().int(),
  printedPage: z.string(),
  headingPath: z.string().optional(),
  score: z.number(),
  text: z.string(),
});
export type RankedChunk = z.infer<typeof RankedChunk>;

export const QueryResult = z.object({
  question: z.string(),
  answer: z.string(),
  status: z.enum(["answered", "not_found"]),
  citations: z.array(Citation),
  images: z.array(ResultImage).max(4),
  trace: z.array(z.object({ stage: TraceStage, note: z.string() })),
  debug: z
    .object({
      filters: z.record(z.string(), z.unknown()).nullable(),
      rewrittenQuery: z.string().nullable(),
      shortlist: z.array(RankedChunk),
      final: z.array(RankedChunk),
      rerankUsed: z.boolean(),
      rerankModel: z.string().nullable(),
      usage: z.record(z.string(), z.unknown()),
    })
    .optional(),
});
export type QueryResult = z.infer<typeof QueryResult>;

export const Metrics = z.object({
  hit1: z.number(),
  hit3: z.number(),
  hit5: z.number(),
  mrr: z.number(),
  n: z.number().int(),
});
export type Metrics = z.infer<typeof Metrics>;

/** UC2 query understanding: the one structured LLM output. */
export const REGIONS = [
  "East Asia and Pacific",
  "Europe and Central Asia",
  "Latin America and the Caribbean",
  "Middle East, North Africa, Afghanistan, and Pakistan",
  "South Asia",
  "Sub-Saharan Africa",
] as const;
export const QueryUnderstanding = z.object({
  region: z.string().nullable(),
  chapter: z.number().int().min(1).max(4).nullable(),
  executive_summary: z.boolean(),
  box: z.boolean(),
  search_query: z.string().min(1),
});
export type QueryUnderstanding = z.infer<typeof QueryUnderstanding>;
