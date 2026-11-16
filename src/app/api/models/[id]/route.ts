import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { FEATURE_META } from '@/lib/ml/dataset'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAuth()
    const { id } = await params
    const mv = await db.modelVersion.findUnique({ where: { id } })
    if (!mv) return errorJson('Model not found', 404)
    const evals = await db.modelEvaluation.findMany({ where: { modelVersionId: id } })
    const artifacts = JSON.parse(mv.artifacts) as {
      featureImportance?: number[]
      referenceBins?: { edges: number[][]; proportions: number[][] }
      trainMeans?: number[]
    }
    return okJson({
      model: {
        id: mv.id,
        name: mv.name,
        algorithm: mv.algorithm,
        versionTag: mv.versionTag,
        status: mv.status,
        isProduction: mv.isProduction,
        trainedAt: mv.trainedAt.toISOString(),
        params: JSON.parse(mv.params),
        trainInfo: JSON.parse(mv.trainInfo),
        featureImportance: (artifacts.featureImportance ?? []).map((imp, i) => ({
          feature: FEATURE_META[i]?.name ?? `f${i}`,
          label: FEATURE_META[i]?.label ?? `feature ${i}`,
          importance: imp,
        })),
        trainMeans: artifacts.trainMeans ?? [],
      },
      evaluations: evals.map((e) => ({
        split: e.split,
        metrics: JSON.parse(e.metrics),
        confusion: JSON.parse(e.confusion),
        calibration: JSON.parse(e.calibration),
      })),
    })
  })
}
