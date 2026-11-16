import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth, requireRole } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { buildFeatureVector } from '@/lib/ml/dataset'
import { buildDemoDataset, trainAllModels, serializeModel } from '@/lib/ml/train'
import { computeFit } from '@/lib/engines/icp'
import { computeIntent } from '@/lib/engines/intent'
import { getActiveIcp, getActiveIntent } from '@/lib/config'
import { invalidateModelCache } from '@/lib/ml/predict'
import { computeDriftReport } from '@/lib/ml/drift'

export async function GET() {
  return handle(async () => {
    await requireAuth()
    const models = await db.modelVersion.findMany({
      orderBy: { trainedAt: 'desc' },
      take: 20,
    })
    const evals = await db.modelEvaluation.findMany({
      where: { split: 'TEST', modelVersionId: { in: models.map((m) => m.id) } },
    })
    return okJson({
      models: models.map((m) => {
        const ev = evals.find((e) => e.modelVersionId === m.id)
        const metrics = ev ? JSON.parse(ev.metrics) : null
        return {
          id: m.id,
          name: m.name,
          algorithm: m.algorithm,
          versionTag: m.versionTag,
          status: m.status,
          isProduction: m.isProduction,
          trainedAt: m.trainedAt.toISOString(),
          params: JSON.parse(m.params),
          metrics,
          trainInfo: JSON.parse(m.trainInfo),
        }
      }),
    })
  })
}

/**
 * Trains all three algorithm families on the current dataset (synthetic
 * demonstration data + any real verified outcomes), selects the best on the
 * validation split, evaluates on the untouched test split and promotes the
 * winner to production.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireRole(['ADMIN'])
    const rl = rateLimit(`train:${ctx.userId}`, 3, 5 * 60_000)
    if (!rl.allowed) return errorJson('Training rate limit reached. Wait a few minutes.', 429)
    void req

    const [icp, intentCfg] = await Promise.all([getActiveIcp(ctx.workspaceId), getActiveIntent(ctx.workspaceId)])

    // Build REAL outcome rows from verified outcomes
    const outcomes = await db.verifiedOutcome.findMany({ where: { workspaceId: ctx.workspaceId } })
    const realRows: { X: number[]; y: number; synthetic: boolean }[] = []
    for (const o of outcomes) {
      const lead = await db.lead.findUnique({
        where: { id: o.leadId },
        include: {
          company: true,
          events: { select: { type: true, occurredAt: true, weight: true }, take: 300, orderBy: { occurredAt: 'desc' } },
        },
      })
      if (!lead) continue
      const fit = computeFit(
        lead.company ?? {
          industry: null,
          employeeCount: null,
          revenueBand: null,
          country: null,
          businessModel: null,
        },
        lead,
        icp.data,
        icp.version,
      )
      const intent = computeIntent(lead.events, intentCfg.data, intentCfg.version)
      const fctx = buildFeatureVector({
        fitScore: fit.score,
        intentScore: intent.score,
        events30d: lead.events.filter((e) => Date.now() - e.occurredAt.getTime() <= 30 * 864e5).length,
        pricingVisits30d: lead.events.filter((e) => e.type === 'PRICING_VISIT' && Date.now() - e.occurredAt.getTime() <= 30 * 864e5).length,
        demoRequested: lead.events.some((e) => e.type === 'DEMO_REQUEST'),
        daysSinceLastEvent: lead.events[0] ? Math.round((Date.now() - lead.events[0].occurredAt.getTime()) / 864e5) : null,
        engagementSpanDays: null,
        industryMatch: lead.company?.industry ? icp.data.targetIndustries.includes(lead.company.industry) : null,
        employeeCount: lead.company?.employeeCount ?? null,
        dealValue: lead.dealValue,
        dataCompleteness: 0.9,
      })
      realRows.push({ X: fctx.values, y: o.outcome === 'WON' ? 1 : 0, synthetic: false })
    }

    const { rows, summary } = buildDemoDataset(realRows, 560, 42 + outcomes.length)
    const { best, all } = trainAllModels(rows)
    const tag = new Date().toISOString().slice(0, 10).replace(/-/g, '')

    // Archive current production
    await db.modelVersion.updateMany({ where: { workspaceId: ctx.workspaceId, isProduction: true }, data: { isProduction: false, status: 'ARCHIVED' } })

    const createdIds: string[] = []
    for (const m of all) {
      const isBest = m === best
      const mv = await db.modelVersion.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: 'leadmind-conversion',
          algorithm: m.algorithm,
          versionTag: `v2.${all.indexOf(m) + 1}.0-${tag}`,
          status: isBest ? 'PRODUCTION' : 'READY',
          params: JSON.stringify(m.params),
          features: JSON.stringify(summary.featureNames),
          artifacts: serializeModel(m),
          trainInfo: JSON.stringify(summary),
          evalMetrics: JSON.stringify({
            threshold: m.test.threshold,
            precision: m.test.precision,
            recall: m.test.recall,
            f1: m.test.f1,
            accuracy: m.test.accuracy,
            rocAuc: m.test.rocAuc,
            prAuc: m.test.prAuc,
            brier: m.test.brier,
          }),
          isProduction: isBest,
        },
      })
      createdIds.push(mv.id)
      for (const split of ['TEST', 'VALIDATION'] as const) {
        const e = split === 'TEST' ? m.test : m.val
        await db.modelEvaluation.create({
          data: {
            modelVersionId: mv.id,
            split,
            metrics: JSON.stringify({
              threshold: e.threshold,
              precision: e.precision,
              recall: e.recall,
              f1: e.f1,
              accuracy: e.accuracy,
              rocAuc: e.rocAuc,
              prAuc: e.prAuc,
              brier: e.brier,
            }),
            confusion: JSON.stringify(e.confusion),
            calibration: JSON.stringify(e.calibration),
          },
        })
      }
    }

    invalidateModelCache()
    const drift = await computeDriftReport(ctx.workspaceId)
    await audit(ctx.workspaceId, ctx.userId, 'MODEL_TRAINED', {
      best: best.algorithm,
      dataset: { total: summary.totalRows, real: summary.realOutcomeRows, synthetic: summary.syntheticRows },
      testRocAuc: best.test.rocAuc,
    })

    return okJson({
      best: {
        algorithm: best.algorithm,
        params: best.params,
        test: best.test,
        val: best.val,
        featureImportance: best.featureImportance,
      },
      comparison: all.map((m) => ({
        algorithm: m.algorithm,
        valPrAuc: m.val.prAuc,
        valRocAuc: m.val.rocAuc,
        testRocAuc: m.test.rocAuc,
        testPrAuc: m.test.prAuc,
        testF1: m.test.f1,
      })),
      dataset: summary,
      drift: { status: drift.status, scoredLeads: drift.scoredLeads },
      modelIds: createdIds,
    })
  })
}
