/**
 * Read cache partitioned by signed-in person and active context, so one
 * person's data can never be served to another after a switch or sign-out.
 */
export class ScopedCache {
  private scope: string | null = null;
  private entries = new Map<string, { at: number; value: unknown }>();

  constructor(private readonly ttlMs = 30_000, private readonly now = () => Date.now()) {}

  /** Sets who is signed in and which context they are in. Changing either empties the cache. */
  setScope(personId: string | null, contextKey: string | null): void {
    const next = personId ? `${personId}|${contextKey ?? ''}` : null;
    if (next !== this.scope) this.entries.clear();
    this.scope = next;
  }

  get(key: string): unknown | undefined {
    if (!this.scope) return undefined;
    const e = this.entries.get(`${this.scope}|${key}`);
    if (!e || this.now() - e.at > this.ttlMs) return undefined;
    return e.value;
  }

  set(key: string, value: unknown): void {
    if (!this.scope) return;
    this.entries.set(`${this.scope}|${key}`, { at: this.now(), value });
  }

  /** Drops entries whose key starts with prefix (after a write that changes them). */
  invalidate(prefix = ''): void {
    if (!this.scope) return;
    const p = `${this.scope}|${prefix}`;
    for (const k of [...this.entries.keys()]) if (k.startsWith(p)) this.entries.delete(k);
  }

  clear(): void {
    this.entries.clear();
    this.scope = null;
  }

  get size(): number {
    return this.entries.size;
  }
}
