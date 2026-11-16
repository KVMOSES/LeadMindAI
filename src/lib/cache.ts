/**
 * Tiny in-process TTL cache. Suitable for a single-node deployment.
 * Values are invalidated by key prefix when dependencies change.
 */
interface Entry<V> {
  value: V
  expiresAt: number
}

const store = new Map<string, Entry<unknown>>()

export function cacheGet<V>(key: string): V | undefined {
  const e = store.get(key) as Entry<V> | undefined
  if (!e) return undefined
  if (e.expiresAt < Date.now()) {
    store.delete(key)
    return undefined
  }
  return e.value
}

export function cacheSet<V>(key: string, value: V, ttlMs = 60_000): V {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
  return value
}

export function cacheInvalidate(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}

/** Memoized async loader with TTL. */
export async function cached<V>(
  key: string,
  ttlMs: number,
  loader: () => Promise<V>,
): Promise<V> {
  const hit = cacheGet<V>(key)
  if (hit !== undefined) return hit
  const value = await loader()
  cacheSet(key, value, ttlMs)
  return value
}

export function cacheClear(): void {
  store.clear()
}
