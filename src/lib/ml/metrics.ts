/** Classification evaluation metrics (threshold-based and rank-based). */

export interface ConfusionMatrix {
  tp: number
  fp: number
  tn: number
  fn: number
}

export interface ThresholdMetrics {
  threshold: number
  precision: number | null
  recall: number
  f1: number | null
  accuracy: number
}

export function confusion(y: number[], p: number[], threshold: number): ConfusionMatrix {
  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0
  for (let i = 0; i < y.length; i++) {
    const pred = p[i] >= threshold ? 1 : 0
    if (y[i] === 1 && pred === 1) tp++
    else if (y[i] === 0 && pred === 1) fp++
    else if (y[i] === 0 && pred === 0) tn++
    else fn++
  }
  return { tp, fp, tn, fn }
}

export function thresholdMetrics(y: number[], p: number[], threshold: number): ThresholdMetrics {
  const cm = confusion(y, p, threshold)
  const precision = cm.tp + cm.fp > 0 ? cm.tp / (cm.tp + cm.fp) : null
  const recall = cm.tp + cm.fn > 0 ? cm.tp / (cm.tp + cm.fn) : 0
  const f1 = precision !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null
  const accuracy = (cm.tp + cm.tn) / y.length
  return { threshold, precision, recall, f1, accuracy }
}

/** Best F1 threshold by sweeping candidate thresholds. */
export function bestF1Threshold(y: number[], p: number[]): number {
  let best = 0.5
  let bestF1 = -1
  for (let t = 0.05; t <= 0.95; t += 0.01) {
    const m = thresholdMetrics(y, p, t)
    const f1 = m.f1 ?? 0
    if (f1 > bestF1) {
      bestF1 = f1
      best = Math.round(t * 100) / 100
    }
  }
  return best
}

/** Rank-based ROC-AUC (handles ties via mid-ranks). */
export function rocAuc(y: number[], p: number[]): number {
  const pos = y.filter((v) => v === 1).length
  const neg = y.length - pos
  if (pos === 0 || neg === 0) return 0.5
  const idx = p.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0])
  const ranks = new Array<number>(p.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const midRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = midRank
    i = j + 1
  }
  let sumPos = 0
  for (let k = 0; k < y.length; k++) if (y[k] === 1) sumPos += ranks[k]
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg)
}

/** PR-AUC via trapezoidal integration of the precision-recall curve. */
export function prAuc(y: number[], p: number[]): number {
  const order = p.map((v, i) => i).sort((a, b) => p[b] - p[a])
  let tp = 0
  let fp = 0
  const totalPos = y.reduce((a, v) => a + v, 0)
  if (totalPos === 0) return 0
  let auc = 0
  let prevRecall = 0
  let prevPrecision = 1
  for (const i of order) {
    if (y[i] === 1) tp++
    else fp++
    const recall = tp / totalPos
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1
    auc += (recall - prevRecall) * ((precision + prevPrecision) / 2)
    prevRecall = recall
    prevPrecision = precision
  }
  return auc
}

export function brierScore(y: number[], p: number[]): number {
  return y.reduce((acc, v, i) => acc + (p[i] - v) ** 2, 0) / y.length
}

export interface CalibrationBin {
  bin: string
  count: number
  avgPredicted: number
  observedRate: number | null
}

export function calibrationBins(y: number[], p: number[], nBins = 10): CalibrationBin[] {
  const bins: CalibrationBin[] = []
  for (let b = 0; b < nBins; b++) {
    const lo = b / nBins
    const hi = (b + 1) / nBins
    const idx = p.map((v, i) => i).filter((i) => (b === nBins - 1 ? p[i] >= lo && p[i] <= hi : p[i] >= lo && p[i] < hi))
    const avgPredicted = idx.length ? idx.reduce((a, i) => a + p[i], 0) / idx.length : (lo + hi) / 2
    const positives = idx.reduce((a, i) => a + y[i], 0)
    bins.push({
      bin: `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`,
      count: idx.length,
      avgPredicted: Math.round(avgPredicted * 1000) / 1000,
      observedRate: idx.length ? Math.round((positives / idx.length) * 1000) / 1000 : null,
    })
  }
  return bins
}
