/**
 * In-memory sliding-window rate limiter, per key (device serial number here).
 * No new dependency — deliberately minimal, since the only requirement is
 * "don't let one misbehaving/spoofed SN hammer the endpoint". FLAG: this
 * state is per-process, so it only throttles per-instance — a multi-instance
 * deployment behind a load balancer would need a shared store (Redis etc.)
 * for this to hold across instances. Fine for the pilot's single-instance
 * deployment; noted in the summary as a scaling follow-up.
 */
export class DeviceRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number = 60_000,
    private readonly maxHits: number = 120,
  ) {}

  /** True if `key` is currently within its allowance; records this call as a hit either way. */
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const existing = this.hits.get(key) ?? [];
    const recent = existing.filter((t) => t > cutoff);
    recent.push(now);
    this.hits.set(key, recent);
    return recent.length <= this.maxHits;
  }
}
