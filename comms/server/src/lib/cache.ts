// Dead-simple in-memory TTL cache. Good enough for a single internal instance.
// (Swap for Redis if you ever run multiple backend instances.)
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

export const cache = {
  get<T>(key: string): T | undefined {
    const e = store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expires) {
      store.delete(key);
      return undefined;
    }
    return e.value as T;
  },
  set<T>(key: string, value: T, ttlMs: number): void {
    store.set(key, { value, expires: Date.now() + ttlMs });
  },
  clear(): void {
    store.clear();
  },
};
