type CacheEntry<T> = { expires: number; value: T; bytes: number };

// Warm-isolate acceleration only. Caller authentication and company/actor binding
// are required before this cache is consulted. Pending failures are never cached.
export class LoadPreviewCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private pending = new Map<string, Promise<T>>();
  private bytes = 0;
  private maxBytes: number;
  private lifetimeMs: number;

  constructor(maxBytes = 16 * 1024 * 1024, lifetimeMs = 20 * 60_000) {
    this.maxBytes = maxBytes;
    this.lifetimeMs = lifetimeMs;
  }

  async getOrCreate(
    key: string,
    create: () => Promise<T>,
    now = Date.now(),
  ): Promise<{ value: T; hit: boolean }> {
    const cached = this.entries.get(key);
    if (cached && cached.expires > now) return { value: structuredClone(cached.value), hit: true };
    if (cached) {
      this.entries.delete(key);
      this.bytes -= cached.bytes;
    }
    const pending = this.pending.get(key);
    if (pending) return { value: structuredClone(await pending), hit: true };
    const task = create();
    this.pending.set(key, task);
    try {
      const value = await task;
      const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
      if (bytes <= this.maxBytes / 2) {
        for (const [oldKey, old] of this.entries) {
          if (old.expires <= Date.now() || this.bytes + bytes > this.maxBytes || this.entries.size >= 24) {
            this.entries.delete(oldKey);
            this.bytes -= old.bytes;
          }
        }
        this.entries.set(key, {
          value: structuredClone(value),
          bytes,
          expires: Date.now() + this.lifetimeMs,
        });
        this.bytes += bytes;
      }
      return { value, hit: false };
    } finally {
      this.pending.delete(key);
    }
  }
}

export function previewCacheKey(
  actor: string,
  company: string,
  checksum: string,
  version: number,
  model: string,
) {
  return JSON.stringify([actor, company, checksum, version, model]);
}
