import { db } from '@/lib/db'
import { cached, cacheInvalidate } from '@/lib/cache'
import { deserializeModel, type DeserializedModel } from './train'
import { FEATURE_META } from './dataset'
import { logRegContributions, type LogRegModel } from './logreg'
import type { PredictionResult } from '@/lib/types'

export interface ProductionModel {
  id: string
  name: string
  algorithm: string
  versionTag: string
  trainedAt: Date
  threshold: number
  evalMetrics: {
    rocAuc: number
    prAuc: number
    f1: number | null
    precision: number | null
    recall: number
    brier: number
  }
  datasetInfo: { totalRows: number; syntheticRows: number; realOutcomeRows: number }
  featureImportance: number[]
  model: DeserializedModel
  trainMeans: number[]
  calibration: { bin: string; count: number; avgPredicted: number; observedRate: number | null }[]
}

interface ModelArtifacts {
  model?: LogRegModel
  trees?: unknown
  init?: number
  learningRate?: number
  trainMeans?: number[]
}

export async function getProductionModel(): Promise<ProductionModel | null> {
  return cached('production-model', 60_000, async () => {
    const mv = await db.modelVersion.findFirst({
      where: { isProduction: true, status: 'PRODUCTION' },
      orderBy: { trainedAt: 'desc' },
    })
    if (!mv) return null
    const artifacts = JSON.parse(mv.artifacts) as ModelArtifacts & Record<string, unknown>
    const evals = await db.modelEvaluation.findFirst({
      where: { modelVersionId: mv.id, split: 'TEST' },
    })
    const metrics = evals ? JSON.parse(evals.metrics) : null
    const calibration = evals ? JSON.parse(evals.calibration) : []
    const datasetInfo = JSON.parse(mv.trainInfo) as ProductionModel['datasetInfo']
    const threshold = metrics?.threshold ?? 0.5
    return {
      id: mv.id,
      name: mv.name,
      algorithm: mv.algorithm,
      versionTag: mv.versionTag,
      trainedAt: mv.trainedAt,
      threshold,
      evalMetrics: {
        rocAuc: metrics?.rocAuc ?? 0,
        prAuc: metrics?.prAuc ?? 0,
        f1: metrics?.f1 ?? null,
        precision: metrics?.precision ?? null,
        recall: metrics?.recall ?? 0,
        brier: metrics?.brier ?? 0,
      },
      datasetInfo,
      featureImportance: (artifacts.featureImportance as number[] | undefined) ?? [],
      model: deserializeModel(mv.artifacts),
      trainMeans: (artifacts.trainMeans as number[]) ?? [],
      calibration,
    }
  })
}

export function invalidateModelCache(): void {
  cacheInvalidate('production-model')
}

function reliabilityNote(probability: number, calibration: ProductionModel['calibration']): string {
  const binIndex = Math.min(9, Math.floor(probability * 10))
  const bin = calibration[binIndex]
  if (!bin || bin.count === 0) {
    return 'Insufficient historical data in this probability band to quantify reliability.'
  }
  return (
    `In the model's held-out test data, leads in the ${(binIndex * 10)}-${(binIndex + 1) * 10}% band ` +
    `converted ${bin.observedRate !== null ? (bin.observedRate * 100).toFixed(0) : '?'}% of the time ` +
    `(${bin.count} examples). Model calibration error (Brier): available on the model detail page.`
  )
}

/**
 * Runs a conversion prediction against the production model.
 * Missing features are replaced by their training means and surfaced as warnings.
 * Contributions are one-at-a-time marginal effects (SHAP-inspired) for tree
 * models and exact analytic contributions for logistic regression.
 */
export function predictFromContext(
  model: ProductionModel,
  values: number[],
  missingFeatures: string[],
): PredictionResult {
  const filled = values.map((v, j) => {
    if (Number.isFinite(v)) return v
    return model.trainMeans[j] ?? 0
  })
  // Replace missing feature values with train means (indices from FEATURE order)
  const missingIdx = missingFeatures
    .map((name) => FEATURE_META.findIndex((f) => f.name === name))
    .filter((i) => i >= 0)
  const x = filled.map((v, j) => (missingIdx.includes(j) ? (model.trainMeans[j] ?? v) : v))

  const probability = model.model.predict(x)
  const warnings: string[] = missingFeatures.map((f) => `Missing feature "${f}" replaced with training mean.`)
  if (missingFeatures.length >= 3) {
    warnings.push('More than 3 input features are missing — treat this prediction with caution.')
  }

  let contributions: PredictionResult['contributions']
  if (model.algorithm === 'LOGISTIC_REGRESSION' && model.model.artifacts.model) {
    const { probContributions } = logRegContributions(model.model.artifacts.model as LogRegModel, x)
    contributions = FEATURE_META.map((f, j) => ({
      feature: f.name,
      label: f.label,
      value: Math.round(x[j] * 100) / 100,
      contribution: Math.round(probContributions[j] * 10000) / 10000,
    })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  } else {
    const deltas = FEATURE_META.map((f, j) => {
      const withMean = [...x]
      withMean[j] = model.trainMeans[j] ?? x[j]
      const pAlt = model.model.predict(withMean)
      return {
        feature: f.name,
        label: f.label,
        value: Math.round(x[j] * 100) / 100,
        contribution: Math.round((probability - pAlt) * 10000) / 10000,
      }
    }).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    contributions = deltas
  }

  return {
    probability: Math.round(probability * 1000) / 1000,
    decision: probability >= model.threshold ? 'WILL_CONVERT' : 'WILL_NOT_CONVERT',
    modelId: model.id,
    modelVersion: `${model.name} ${model.versionTag} (${model.algorithm})`,
    algorithm: model.algorithm,
    threshold: model.threshold,
    contributions,
    warnings,
    reliability: reliabilityNote(probability, model.calibration),
    features: Object.fromEntries(FEATURE_META.map((f, j) => [f.name, Math.round(x[j] * 1000) / 1000])),
  }
}
