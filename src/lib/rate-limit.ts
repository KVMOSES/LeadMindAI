/**
 * Simple in-memory sliding-window rate limiter (per key).
 * Suitable for a single-node sandbox deployment.
 */
interface Bucket {
  hits: number[]
}

const buckets = new Map<string, Bucket>()

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { hits: [] }
    buckets.set(key, bucket)
  }
  bucket.hits = bucket.hits.filter((t) => t > now - windowMs)
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0]
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
    }
  }
  bucket.hits.push(now)
  // Opportunistic cleanup
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (b.hits.every((t) => t <= now - windowMs)) buckets.delete(k)
    }
  }
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterMs: 0 }
}
