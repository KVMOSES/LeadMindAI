/** Deterministic seeded RNG (mulberry32) so every training run is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  next: () => number
  uniform(lo: number, hi: number): number
  int(lo: number, hi: number): number
  normal(mean: number, std: number): number
  bernoulli(p: number): number
  choice<T>(arr: T[]): T
  pick<T>(arr: T[], n: number): T[]
  shuffle<T>(arr: T[]): T[]
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed)
  const normal = (mean: number, std: number) => {
    // Box-Muller
    const u1 = Math.max(next(), 1e-9)
    const u2 = next()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return mean + std * z
  }
  return {
    next,
    uniform: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    normal,
    bernoulli: (p) => (next() < p ? 1 : 0),
    choice: <T,>(arr: T[]) => arr[Math.floor(next() * arr.length)],
    pick: <T,>(arr: T[], n: number) => {
      const copy = [...arr]
      const out: T[] = []
      for (let i = 0; i < n && copy.length > 0; i++) {
        out.push(copy.splice(Math.floor(next() * copy.length), 1)[0])
      }
      return out
    },
    shuffle: <T,>(arr: T[]) => {
      const a = [...arr]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
      }
      return a
    },
  }
}
