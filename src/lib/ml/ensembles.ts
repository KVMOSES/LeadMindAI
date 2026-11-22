import { buildTree, predictTree, treeImportance, type TreeNode } from './trees'
import { makeRng } from './rng'

/**
 * Random Forest classifier: bootstrap-aggregated CART trees on 0/1 targets
 * with per-split feature subsampling.
 */
export interface RandomForestModel {
  trees: TreeNode[]
}

export function fitRandomForest(
  X: number[][],
  y: number[],
  opts: { nTrees: number; maxDepth: number; minSamplesLeaf: number; seed: number },
): RandomForestModel {
  const rng = makeRng(opts.seed)
  const mtry = Math.max(1, Math.floor(Math.sqrt(X[0].length)))
  const trees: TreeNode[] = []
  for (let t = 0; t < opts.nTrees; t++) {
    // Bootstrap sample
    const bx: number[][] = []
    const by: number[] = []
    for (let i = 0; i < X.length; i++) {
      const idx = rng.int(0, X.length - 1)
      bx.push(X[idx])
      by.push(y[idx])
    }
    trees.push(
      buildTree(bx, by, {
        maxDepth: opts.maxDepth,
        minSamplesLeaf: opts.minSamplesLeaf,
        maxFeatures: mtry,
        rngSeed: opts.seed * 1000 + t,
      }),
    )
  }
  return { trees }
}

export function predictRandomForest(model: RandomForestModel, x: number[]): number {
  const sum = model.trees.reduce((acc, t) => acc + predictTree(t, x), 0)
  return sum / model.trees.length
}

export function randomForestImportance(model: RandomForestModel, d: number): number[] {
  const out = new Array<number>(d).fill(0)
  for (const t of model.trees) treeImportance(t, out)
  const total = out.reduce((a, v) => a + v, 0) || 1
  return out.map((v) => v / total)
}

/**
 * Gradient Boosting for classification: logistic loss, regression trees fitted
 * to negative gradients (residuals), with row subsampling per round.
 */
export interface GbmModel {
  init: number // initial log-odds
  learningRate: number
  trees: TreeNode[]
}

export function fitGbm(
  X: number[][],
  y: number[],
  opts: { nRounds: number; learningRate: number; maxDepth: number; minSamplesLeaf: number; seed: number; subsample?: number },
): GbmModel {
  const posRate = y.reduce((a, v) => a + v, 0) / y.length
  const p0 = Math.min(Math.max(posRate, 1e-6), 1 - 1e-6)
  const init = Math.log(p0 / (1 - p0))
  const F = new Array<number>(X.length).fill(init)
  const trees: TreeNode[] = []
  const rng = makeRng(opts.seed)
  const subsample = opts.subsample ?? 0.8

  for (let round = 0; round < opts.nRounds; round++) {
    const grad = F.map((f, i) => y[i] - 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, f)))))
    // Subsample rows for this round
    const rows: number[] = []
    for (let i = 0; i < X.length; i++) if (rng.next() < subsample) rows.push(i)
    if (rows.length < 20) rows.push(...rng.pick(X.map((_, i) => i), 20))
    const tree = buildTree(
      rows.map((i) => X[i]),
      rows.map((i) => grad[i]),
      {
        maxDepth: opts.maxDepth,
        minSamplesLeaf: opts.minSamplesLeaf,
        rngSeed: opts.seed * 7919 + round,
      },
    )
    for (let i = 0; i < X.length; i++) {
      F[i] += opts.learningRate * predictTree(tree, X[i])
    }
    trees.push(tree)
  }
  return { init, learningRate: opts.learningRate, trees }
}

export function predictGbm(model: GbmModel, x: number[]): number {
  let f = model.init
  for (const t of model.trees) f += model.learningRate * predictTree(t, x)
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, f))))
}

export function gbmImportance(model: GbmModel, d: number): number[] {
  const out = new Array<number>(d).fill(0)
  for (const t of model.trees) treeImportance(t, out)
  const total = out.reduce((a, v) => a + v, 0) || 1
  return out.map((v) => v / total)
}
