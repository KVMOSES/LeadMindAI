import { makeRng } from './rng'

/**
 * CART regression tree (variance-reduction splits) — the base learner for
 * Random Forest (bagged) and Gradient Boosting (fitted to gradients).
 * Serialized as a compact nested object: {f, t, l, r, v}.
 */
export interface TreeNode {
  /** feature index for internal nodes */
  f?: number
  /** split threshold */
  t?: number
  /** left child (value < t) */
  l?: TreeNode
  /** right child */
  r?: TreeNode
  /** leaf value */
  v?: number
  /** split improvement (variance reduction), for feature importance */
  imp?: number
}

interface TrainOpts {
  maxDepth: number
  minSamplesLeaf: number
  maxFeatures?: number // feature subsampling (sqrt for RF)
  rngSeed?: number
  minImprovement?: number
}

interface SplitCandidate {
  feature: number
  threshold: number
  improvement: number
}

function variance(values: number[]): number {
  const n = values.length
  if (n === 0) return 0
  const mean = values.reduce((a, v) => a + v, 0) / n
  return values.reduce((a, v) => a + (v - mean) ** 2, 0) / n
}

function findBestSplit(
  X: number[][],
  targets: number[],
  featureIdx: number[],
  minSamplesLeaf: number,
): SplitCandidate | null {
  const n = targets.length
  const parentVar = variance(targets)
  if (n < 2 * minSamplesLeaf || parentVar <= 1e-12) return null

  let best: SplitCandidate | null = null
  for (const f of featureIdx) {
    const vals = X.map((row, i) => [row[f], i] as [number, number]).sort((a, b) => a[0] - b[0])
    // Candidate thresholds: midpoints between consecutive distinct values (up to 24 via quantiles)
    const distinct: number[] = []
    for (const [v] of vals) {
      if (distinct.length === 0 || v !== distinct[distinct.length - 1]) distinct.push(v)
    }
    let candidates: number[]
    if (distinct.length - 1 <= 24) {
      candidates = []
      for (let k = 0; k < distinct.length - 1; k++) candidates.push((distinct[k] + distinct[k + 1]) / 2)
    } else {
      candidates = []
      for (let k = 1; k <= 24; k++) {
        const q = distinct[Math.floor((k * (distinct.length - 1)) / 25)]
        candidates.push(q)
      }
    }
    for (const t of candidates) {
      let leftSum = 0
      let leftSq = 0
      let leftN = 0
      for (const [v, i] of vals) {
        if (v < t) {
          leftSum += targets[i]
          leftSq += targets[i] * targets[i]
          leftN++
        }
      }
      if (leftN < minSamplesLeaf || n - leftN < minSamplesLeaf) continue
      const leftMean = leftSum / leftN
      const leftVar = leftSq / leftN - leftMean * leftMean
      const rightMean = (targets.reduce((a, v) => a + v, 0) - leftSum) / (n - leftN)
      const rightSq = targets.reduce((a, v) => a + v * v, 0) - leftSq
      const rightVar = rightSq / (n - leftN) - rightMean * rightMean
      const weighted = (leftN / n) * leftVar + ((n - leftN) / n) * rightVar
      const improvement = parentVar - weighted
      if (improvement > (best?.improvement ?? 0)) {
        best = { feature: f, threshold: t, improvement }
      }
    }
  }
  return best
}

export function buildTree(X: number[][], targets: number[], opts: TrainOpts, depth = 0): TreeNode {
  const leafValue = targets.reduce((a, v) => a + v, 0) / targets.length
  if (depth >= opts.maxDepth || targets.length < 2 * opts.minSamplesLeaf) {
    return { v: leafValue }
  }
  const featureIdx =
    opts.maxFeatures && opts.maxFeatures < X[0].length
      ? makeRng((opts.rngSeed ?? 1) + depth * 977 + targets.length).pick(
          X[0].map((_, i) => i),
          opts.maxFeatures,
        )
      : X[0].map((_, i) => i)

  const split = findBestSplit(X, targets, featureIdx, opts.minSamplesLeaf)
  if (!split || split.improvement < (opts.minImprovement ?? 1e-7)) {
    return { v: leafValue }
  }
  const leftX: number[][] = []
  const leftY: number[] = []
  const rightX: number[][] = []
  const rightY: number[] = []
  for (let i = 0; i < X.length; i++) {
    if (X[i][split.feature] < split.threshold) {
      leftX.push(X[i])
      leftY.push(targets[i])
    } else {
      rightX.push(X[i])
      rightY.push(targets[i])
    }
  }
  const childOpts = { ...opts, rngSeed: (opts.rngSeed ?? 1) * 31 + depth }
  return {
    f: split.feature,
    t: split.threshold,
    imp: split.improvement * targets.length,
    l: buildTree(leftX, leftY, childOpts, depth + 1),
    r: buildTree(rightX, rightY, childOpts, depth + 1),
  }
}

export function predictTree(node: TreeNode, x: number[]): number {
  let cur = node
  while (cur.v === undefined) {
    cur = x[cur.f as number] < (cur.t as number) ? (cur.l as TreeNode) : (cur.r as TreeNode)
  }
  return cur.v
}

/** Accumulates variance-reduction based feature importance over a tree. */
export function treeImportance(node: TreeNode, out: number[]): void {
  if (node.v !== undefined || node.f === undefined) return
  out[node.f] = (out[node.f] ?? 0) + (node.imp ?? 0)
  treeImportance(node.l as TreeNode, out)
  treeImportance(node.r as TreeNode, out)
}
