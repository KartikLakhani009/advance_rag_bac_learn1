import fs from "node:fs";
import path from "node:path";
import { PROCESSED_DIR } from "@rag/core/src/cache.js";
import { Chunk } from "@rag/core/src/schemas.js";
import { UC } from "./chunks.js";

/** Whole-table chunks (with their endnotes) by id: the "big" side of the small-to-big swap. */
export function loadTables(): Map<string, Chunk> {
  const f = path.join(PROCESSED_DIR, UC, "parents.json");
  if (!fs.existsSync(f)) throw new Error("No parents.json for uc3. Run: npm run uc3:ingest");
  return new Map((JSON.parse(fs.readFileSync(f, "utf8")) as unknown[]).map((c) => Chunk.parse(c)).map((c) => [c.id, c]));
}
