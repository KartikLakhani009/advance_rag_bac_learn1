export interface ModelUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
}

const table = new Map<string, ModelUsage>();

function row(model: string): ModelUsage {
  let r = table.get(model);
  if (!r) {
    r = { requests: 0, inputTokens: 0, outputTokens: 0, cacheHits: 0 };
    table.set(model, r);
  }
  return r;
}

export function recordUsage(model: string, inputTokens = 0, outputTokens = 0): void {
  const r = row(model);
  r.requests += 1;
  r.inputTokens += inputTokens;
  r.outputTokens += outputTokens;
}

export function recordCacheHit(model: string): void {
  row(model).cacheHits += 1;
}

export function usageSnapshot(): Record<string, ModelUsage> {
  return Object.fromEntries([...table.entries()].map(([k, v]) => [k, { ...v }]));
}

export function usageDelta(before: Record<string, ModelUsage>, after: Record<string, ModelUsage>): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = {};
  for (const [k, v] of Object.entries(after)) {
    const b = before[k] ?? { requests: 0, inputTokens: 0, outputTokens: 0, cacheHits: 0 };
    const d = {
      requests: v.requests - b.requests,
      inputTokens: v.inputTokens - b.inputTokens,
      outputTokens: v.outputTokens - b.outputTokens,
      cacheHits: v.cacheHits - b.cacheHits,
    };
    if (d.requests || d.cacheHits) out[k] = d;
  }
  return out;
}
