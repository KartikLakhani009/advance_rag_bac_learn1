import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { recordCacheHit } from "./usage.js";

export const PROCESSED_DIR = path.join(ROOT, "data", "processed");

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Stable hash of any JSON-able value (key order independent for plain objects). */
export function hashOf(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  return sha256(JSON.stringify(stable(value)));
}

/** File-per-key JSON cache under data/processed/<namespace>/. */
export class DiskCache {
  constructor(
    readonly namespace: string,
    readonly dir: string = path.join(PROCESSED_DIR, namespace),
  ) {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  get<T>(key: string, model?: string): T | undefined {
    const f = this.file(key);
    if (!fs.existsSync(f)) return undefined;
    if (model) recordCacheHit(model);
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  }

  set(key: string, value: unknown): void {
    fs.writeFileSync(this.file(key), JSON.stringify(value));
  }

  async getOrCompute<T>(key: string, compute: () => Promise<T>, model?: string): Promise<T> {
    const hit = this.get<T>(key, model);
    if (hit !== undefined) return hit;
    const v = await compute();
    this.set(key, v);
    return v;
  }
}

/** Single-file key/value store, loaded in memory and written on flush(). For many small values (embeddings). */
export class JsonKV<T> {
  private map: Record<string, T>;
  private dirty = false;
  readonly file: string;

  constructor(namespace: string, name: string) {
    const dir = path.join(PROCESSED_DIR, namespace);
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${name}.json`);
    this.map = fs.existsSync(this.file) ? (JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, T>) : {};
  }

  get(key: string): T | undefined {
    return this.map[key];
  }

  set(key: string, value: T): void {
    this.map[key] = value;
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    fs.writeFileSync(this.file, JSON.stringify(this.map));
    this.dirty = false;
  }
}
