import { db } from '@/lib/db'
import { getProductionModel } from './predict'
import { FEATURE_META } from './dataset'

export interface PsiResult {
  status: 'STABLE' | 'WARNING' | 'ALERT'
  features: { feature: string; label: string; psi: number; level: 'STABLE' | 'WARNING' | 'ALERT' }[]
  scoredLeads: number
  comparedAgainst: string | null
  overallPsi: number
}

function psiForFeature(
  values: number[],
  edges: number[],
  expected: number[],
): number {
  const counts = new Array<number>(10).fill(0)
  for (const v of values) {
    let b = edges.findIndex((edge) => v < edge)
    if (b === -1) b = 9
    counts[b]++
  }
  const actual = counts.map((c) => c / Math.max(values.length, 1))
  let psi = 0
  for (let i = 0; i < 10; i++) {
    const a = Math.max(actual[i], 1e-4)
    const b = Math.max(expected[i] ?? 1 / 10, 1e-4)
    psi += (a - b) * Math.log(a / b)
  }
  return Math.round(psi * 10000) / 10000
}

/**
 * Population Stability Index drift report: compares the feature distribution
 * of recently assessed workspace leads against the model's training reference.
 */
type ReferenceBins = { edges: number[][]; proportions: number[][] }

export async function computeDriftReport(workspaceId: string): Promise<PsiResult> {
  const model = await getProductionModel()
  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000)

  // Feature values reconstructed from stored prediction assessments
  const preds = await db.assessment.findMany({
    where: { workspaceId, kind: 'PREDICTION', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 400,
  })

  let reference: ReferenceBins | null = null
  if (model) {
    // referenceBins were serialized inside artifacts
    const raw = await db.modelVersion.findUnique({ where: { id: model.id } })
    if (raw) {
      const parsed = JSON.parse(raw.artifacts) as { referenceBins?: ReferenceBins }
      reference = parsed.referenceBins ?? null
    }
  }

  const features: PsiResult['features'] = []
  const featureRows: number[][] = []
  for (const p of preds) {
    const payload = JSON.parse(p.payload) as { features?: Record<string, number> }
    if (payload.features) {
      featureRows.push(FEATURE_META.map((f) => payload.features![f.name] ?? 0))
    }
  }

  let overall = 0
  if (reference && featureRows.length >= 20 && model) {
    for (let j = 0; j < FEATURE_META.length; j++) {
      const values = featureRows.map((r) => r[j])
      const psi = psiForFeature(values, reference.edges[j], reference.proportions[j])
      const level = psi < 0.1 ? 'STABLE' : psi < 0.25 ? 'WARNING' : 'ALERT'
      features.push({ feature: FEATURE_META[j].name, label: FEATURE_META[j].label, psi, level })
    }
    overall = Math.round((features.reduce((a, f) => a + f.psi, 0) / features.length) * 10000) / 10000
  }

  const status =
    features.some((f) => f.level === 'ALERT') ? 'ALERT' : features.some((f) => f.level === 'WARNING') ? 'WARNING' : 'STABLE'

  const result: PsiResult = {
    status: features.length === 0 ? 'STABLE' : status,
    features,
    scoredLeads: featureRows.length,
    comparedAgainst: model ? `${model.name} ${model.versionTag}` : null,
    overallPsi: overall,
  }

  await db.driftReport.create({
    data: {
      workspaceId,
      modelVersionId: model?.id ?? null,
      status: result.status,
      psi: JSON.stringify(Object.fromEntries(features.map((f) => [f.feature, f.psi]))),
      details: JSON.stringify(result),
    },
  })

  return result
}
