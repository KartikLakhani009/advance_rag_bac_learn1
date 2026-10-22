import fs from "node:fs";
import path from "node:path";
import { PROCESSED_DIR } from "@rag/core/src/cache.js";
import { ParentChunk } from "@rag/core/src/schemas.js";
import { UC } from "./chunks.js";

export function loadParents(): Map<string, ParentChunk> {
  const f = path.join(PROCESSED_DIR, UC, "parents.json");
  if (!fs.existsSync(f)) throw new Error("No parents.json for uc2. Run: npm run uc2:ingest");
  return new Map((JSON.parse(fs.readFileSync(f, "utf8")) as unknown[]).map((p) => ParentChunk.parse(p)).map((p) => [p.id, p]));
}
