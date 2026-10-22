/**
 * Sliding-window limiter for requests per minute and (optionally) tokens per minute.
 * `acquire(tokens)` resolves when the call may go ahead.
 */
export class RateLimiter {
  private reqTimes: number[] = [];
  private tokEvents: Array<{ t: number; n: number }> = [];

  constructor(
    private readonly rpm: number,
    private readonly tpm?: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async acquire(tokens = 0): Promise<void> {
    const windowMs = 60_000;
    for (;;) {
      const t = this.now();
      this.reqTimes = this.reqTimes.filter((x) => t - x < windowMs);
      this.tokEvents = this.tokEvents.filter((e) => t - e.t < windowMs);
      let wait = 0;
      if (this.rpm > 0 && this.reqTimes.length >= this.rpm) wait = Math.max(wait, windowMs - (t - this.reqTimes[0]!));
      if (this.tpm && tokens > 0) {
        const used = this.tokEvents.reduce((s, e) => s + e.n, 0);
        // a single call larger than the whole budget is let through once the window is empty
        if (used > 0 && used + tokens > this.tpm) {
          let acc = used;
          for (const e of this.tokEvents) {
            acc -= e.n;
            wait = Math.max(wait, windowMs - (t - e.t));
            if (acc + tokens <= this.tpm) break;
          }
        }
      }
      if (wait <= 0) {
        this.reqTimes.push(t);
        if (tokens > 0) this.tokEvents.push({ t, n: tokens });
        return;
      }
      await this.sleep(Math.ceil(wait) + 25);
    }
  }
}
