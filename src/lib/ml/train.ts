import { FEATURE_NAMES, FEATURE_LABELS, generateSyntheticDataset } from './dataset'
import { fitLogReg, predictLogReg, type LogRegModel } from './logreg'
import { fitRandomForest, predictRandomForest, randomForestImportance, type RandomForestModel } from './ensembles'
import { fitGbm, predictGbm, gbmImportance, type GbmModel } from './ensembles'
import { type TreeNode, treeImportance } from './trees'
import {
  bestF1Threshold,
  brierScore,
  calibrationBins,
  prAuc,
  rocAuc,
  thresholdMetrics,
  type CalibrationBin,
} from './metrics'
import { makeRng } from './rng'

export interface TrainRow {
  X: number[]
  y: number
  synthetic: boolean
}

export interface EvalBundle {
  split: string
  threshold: number
  precision: number | null
  recall: number
  f1: number | null
  accuracy: number
  rocAuc: number
  prAuc: number
  brier: number
  confusion: { tp: number; fp: number; tn: number; fn: number }
  calibration: CalibrationBin[]
}

export interface TrainedModel {
  algorithm: 'LOGISTIC_REGRESSION' | 'RANDOM_FOREST' | 'GRADIENT_BOOSTING'
  params: Record<string, number>
  val: EvalBundle
  /** metrics on the untouched test set */
  test: EvalBundle
  featureImportance: number[]
  artifacts: Record<string, unknown>
  predict: (x: number[]) => number
}

interface Split {
  trainX: number[][]
  trainY: number[]
  valX: number[][]
  valY: number[]
  testX: number[][]
  testY: number[]
}

/** Stratified 60/20/20 split using a seeded shuffle (test set never touched during tuning). */
export function stratifiedSplit(rows: TrainRow[], seed = 7): Split {
  const rng = makeRng(seed)
  const pos = rows.filter((r) => r.y === 1)
  const neg = rows.filter((r) => r.y === 0)
  const splitRows = (arr: TrainRow[]) => {
    const s = rng.shuffle(arr)
    const nVal = Math.floor(s.length * 0.2)
    const nTest = Math.floor(s.length * 0.2)
    return {
      val: s.slice(0, nVal),
      test: s.slice(nVal, nVal + nTest),
      train: s.slice(nVal + nTest),
    }
  }
  const posS = splitRows(pos)
  const negS = splitRows(neg)
  const merge = (...groups: TrainRow[][]) => {
    const all = groups.flat()
    return {
      X: all.map((r) => r.X),
      y: all.map((r) => r.y),
    }
  }
  const train = merge(posS.train, negS.train)
  const val = merge(posS.val, negS.val)
  const test = merge(posS.test, negS.test)
  return { trainX: train.X, trainY: train.y, valX: val.X, valY: val.y, testX: test.X, testY: test.y }
}

function evaluate(yTrue: number[], p: number[], split: string): EvalBundle {
  const threshold = bestF1Threshold(yTrue, p)
  const m = thresholdMetrics(yTrue, p, threshold)
  const cm = {
    tp: 0,
    fp: 0,
    tn: 0,
    fn: 0,
  }
  for (let i = 0; i < yTrue.length; i++) {
    const pred = p[i] >= threshold ? 1 : 0
    if (yTrue[i] === 1 && pred === 1) cm.tp++
    else if (yTrue[i] === 0 && pred === 1) cm.fp++
    else if (yTrue[i] === 0 && pred === 0) cm.tn++
    else cm.fn++
  }
  return {
    split,
    threshold,
    precision: m.precision !== null ? Math.round(m.precision * 1000) / 1000 : null,
    recall: Math.round(m.recall * 1000) / 1000,
    f1: m.f1 !== null ? Math.round(m.f1 * 1000) / 1000 : null,
    accuracy: Math.round(m.accuracy * 1000) / 1000,
    rocAuc: Math.round(rocAuc(yTrue, p) * 1000) / 1000,
    prAuc: Math.round(prAuc(yTrue, p) * 1000) / 1000,
    brier: Math.round(brierScore(yTrue, p) * 1000) / 1000,
    confusion: cm,
    calibration: calibrationBins(yTrue, p),
  }
}

/** Reference distribution per feature for PSI drift monitoring (deciles on train data). */
export function buildReferenceBins(X: number[][]): {
  edges: number[][]
  proportions: number[][]
} {
  const d = X[0].length
  const edges: number[][] = []
  const proportions: number[][] = []
  for (let j = 0; j < d; j++) {
    const vals = X.map((r) => r[j]).sort((a, b) => a - b)
    const e: number[] = []
    for (let q = 1; q <= 9; q++) {
      const idx = Math.floor((q * vals.length) / 10)
      e.push(vals[Math.min(idx, vals.length - 1)])
    }
    // Count bucket membership
    const counts = new Array<number>(10).fill(0)
    for (const v of vals) {
      let b = e.findIndex((edge) => v < edge)
      if (b === -1) b = 9
      counts[b]++
    }
    edges.push(e)
    proportions.push(counts.map((c) => c / vals.length))
  }
  return { edges, proportions }
}

function normalizedImportance(imp: number[]): number[] {
  const total = imp.reduce((a, v) => a + v, 0) || 1
  return imp.map((v) => Math.round((v / total) * 1000) / 1000)
}

/**
 * Full training pipeline: leakage-safe split → bounded grid search on the
 * validation split → final evaluation on the untouched test split.
 * Three algorithm families are compared (logistic regression, random forest,
 * gradient boosted trees).
 */
export function trainAllModels(rows: TrainRow[]): {
  best: TrainedModel
  all: TrainedModel[]
} {
  const split = stratifiedSplit(rows)

  const results: TrainedModel[] = []

  // Column means of the training set (for marginal explanations + missing-value imputation)
  const trainMeans = FEATURE_NAMES.map((_, j) => {
    const col = split.trainX.map((r) => r[j])
    return col.reduce((a, v) => a + v, 0) / col.length
  })
  const referenceBins = buildReferenceBins(split.trainX)

  // ── Logistic Regression ──
  const lrGrid = [
    { lr: 0.05, epochs: 350, l2: 0.001 },
    { lr: 0.1, epochs: 350, l2: 0.001 },
    { lr: 0.1, epochs: 350, l2: 0.01 },
  ]
  let bestLr: { model: LogRegModel; params: Record<string, number>; valP: number[] } | null = null
  let bestLrScore = -1
  for (const g of lrGrid) {
    const model = fitLogReg(split.trainX, split.trainY, g)
    const valP = split.valX.map((x) => predictLogReg(model, x))
    const score = prAuc(split.valY, valP)
    if (score > bestLrScore) {
      bestLrScore = score
      bestLr = { model, params: { ...g }, valP }
    }
  }
  {
    const model = bestLr!.model
    const valP = bestLr!.valP
    const val = evaluate(split.valY, valP, 'VALIDATION')
    const testP = split.testX.map((x) => predictLogReg(model, x))
    const test = evaluate(split.testY, testP, 'TEST')
    const importance = normalizedImportance(model.weights.map((w) => Math.abs(w)))
    results.push({
      algorithm: 'LOGISTIC_REGRESSION',
      params: bestLr!.params,
      val,
      test,
      featureImportance: importance,
      artifacts: { model, trainMeans, referenceBins },
      predict: (x) => predictLogReg(model, x),
    })
  }

  // ── Random Forest ──
  const rfGrid = [
    { nTrees: 40, maxDepth: 5, minSamplesLeaf: 8 },
    { nTrees: 60, maxDepth: 7, minSamplesLeaf: 6 },
  ]
  let bestRf: { model: RandomForestModel; params: Record<string, number>; valP: number[] } | null = null
  let bestRfScore = -1
  for (const g of rfGrid) {
    const model = fitRandomForest(split.trainX, split.trainY, { ...g, seed: 11 })
    const valP = split.valX.map((x) => predictRandomForest(model, x))
    const score = prAuc(split.valY, valP)
    if (score > bestRfScore) {
      bestRfScore = score
      bestRf = { model, params: { ...g }, valP }
    }
  }
  {
    const model = bestRf!.model
    const val = evaluate(split.valY, bestRf!.valP, 'VALIDATION')
    const testP = split.testX.map((x) => predictRandomForest(model, x))
    const test = evaluate(split.testY, testP, 'TEST')
    results.push({
      algorithm: 'RANDOM_FOREST',
      params: bestRf!.params,
      val,
      test,
      featureImportance: normalizedImportance(randomForestImportance(model, FEATURE_NAMES.length)),
      artifacts: { trees: model.trees, trainMeans, referenceBins },
      predict: (x) => predictRandomForest(model, x),
    })
  }

  // ── Gradient Boosting ──
  const gbmGrid = [
    { nRounds: 90, learningRate: 0.05, maxDepth: 3, minSamplesLeaf: 10 },
    { nRounds: 140, learningRate: 0.08, maxDepth: 3, minSamplesLeaf: 10 },
  ]
  let bestGbm: { model: GbmModel; params: Record<string, number>; valP: number[] } | null = null
  let bestGbmScore = -1
  for (const g of gbmGrid) {
    const model = fitGbm(split.trainX, split.trainY, { ...g, seed: 23, subsample: 0.8 })
    const valP = split.valX.map((x) => predictGbm(model, x))
    const score = prAuc(split.valY, valP)
    if (score > bestGbmScore) {
      bestGbmScore = score
      bestGbm = { model, params: { ...g }, valP }
    }
  }
  {
    const model = bestGbm!.model
    const val = evaluate(split.valY, bestGbm!.valP, 'VALIDATION')
    const testP = split.testX.map((x) => predictGbm(model, x))
    const test = evaluate(split.testY, testP, 'TEST')
    const imp = new Array<number>(FEATURE_NAMES.length).fill(0)
    for (const t of model.trees) treeImportance(t, imp)
    results.push({
      algorithm: 'GRADIENT_BOOSTING',
      params: bestGbm!.params,
      val,
      test,
      featureImportance: normalizedImportance(gbmImportance(model, FEATURE_NAMES.length)),
      artifacts: { init: model.init, learningRate: model.learningRate, trees: model.trees, trainMeans, referenceBins },
      predict: (x) => predictGbm(model, x),
    })
  }

  // Select best by validation PR-AUC
  const best = results.reduce((a, b) => (b.val.prAuc > a.val.prAuc ? b : a))
  return { best, all: results }
}

/** Serializes a trained model for persistence. */
export function serializeModel(m: TrainedModel): string {
  return JSON.stringify({
    algorithm: m.algorithm,
    params: m.params,
    artifacts: m.artifacts,
    featureImportance: m.featureImportance,
  })
}

export interface DeserializedModel {
  algorithm: string
  predict: (x: number[]) => number
  featureImportance: number[]
  artifacts: Record<string, unknown>
}

export function deserializeModel(json: string): DeserializedModel {
  const parsed = JSON.parse(json) as {
    algorithm: string
    artifacts: Record<string, unknown>
    featureImportance: number[]
  }
  let predict: (x: number[]) => number
  if (parsed.algorithm === 'LOGISTIC_REGRESSION') {
    const model = parsed.artifacts.model as LogRegModel
    predict = (x) => predictLogReg(model, x)
  } else if (parsed.algorithm === 'RANDOM_FOREST') {
    const trees = parsed.artifacts.trees as TreeNode[]
    predict = (x) => predictRandomForest({ trees }, x)
  } else {
    const { init, learningRate, trees } = parsed.artifacts as { init: number; learningRate: number; trees: TreeNode[] }
    predict = (x) => predictGbm({ init, learningRate, trees }, x)
  }
  return {
    algorithm: parsed.algorithm,
    predict,
    featureImportance: parsed.featureImportance,
    artifacts: parsed.artifacts,
  }
}

/** Assembles the demo dataset: synthetic majority + any real verified outcomes. */
export function buildDemoDataset(realRows: TrainRow[], syntheticCount = 560, seed = 42): {
  rows: TrainRow[]
  summary: ReturnType<typeof buildSummary>
} {
  const { X, y } = generateSyntheticDataset(syntheticCount, seed)
  const rows: TrainRow[] = X.map((x, i) => ({ X: x, y: y[i], synthetic: true }))
  rows.push(...realRows)
  return { rows, summary: buildSummary(rows) }
}

function buildSummary(rows: TrainRow[]) {
  const positives = rows.reduce((a, r) => a + r.y, 0)
  const synthetic = rows.filter((r) => r.synthetic).length
  return {
    totalRows: rows.length,
    syntheticRows: synthetic,
    realOutcomeRows: rows.length - synthetic,
    positives,
    negatives: rows.length - positives,
    featureNames: FEATURE_NAMES,
    featureLabels: FEATURE_LABELS,
    isSyntheticDominant: synthetic > rows.length - synthetic,
  }
}
