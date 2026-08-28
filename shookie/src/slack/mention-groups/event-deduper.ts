const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_KEYS = 20_000;

/** Bounded process-local guard for Slack retries and concurrent duplicate deliveries. */
export class MentionEventDeduper {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxKeys = DEFAULT_MAX_KEYS,
    private readonly now: () => number = Date.now,
  ) {}

  claim(eventId: string, messageKey: string): boolean {
    const now = this.now();
    this.removeExpired(now);
    const eventKey = `event:${eventId}`;
    const targetKey = `message:${messageKey}`;
    if (this.seen.has(eventKey) || this.seen.has(targetKey)) return false;

    const expiresAt = now + this.ttlMs;
    this.seen.set(eventKey, expiresAt);
    this.seen.set(targetKey, expiresAt);
    this.trimToLimit();
    return true;
  }

  private removeExpired(now: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }

  private trimToLimit(): void {
    while (this.seen.size > this.maxKeys) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (!oldest) return;
      this.seen.delete(oldest);
    }
  }
}
