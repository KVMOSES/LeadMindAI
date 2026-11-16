import { db } from '@/lib/db'
import { contentHash } from '@/lib/hash'
import { getActiveIcp, getActiveIntent, getQualificationThresholds } from '@/lib/config'
import { computeFit } from '@/lib/engines/icp'
import { computeIntent } from '@/lib/engines/intent'
import { computeQualification } from '@/lib/engines/qualification'
import { generateRecommendations, learnPriors } from '@/lib/engines/nba'
import { getProductionModel, predictFromContext, invalidateModelCache } from '@/lib/ml/predict'
import { FEATURE_NAMES, buildFeatureVector } from '@/lib/ml/dataset'
import type {
  FitResult,
  IntentResult,
  PredictionResult,
  QualificationResult,
  RecommendationDraft,
  TraceStep,
} from '@/lib/types'

const DAY = 24 * 3600 * 1000

export type { TraceStep }

export interface LeadBundle {
  lead: {
    id: string
    contactName: string
    email: string | null
    phone: string | null
    title: string | null
    status: string
    source: string | null
    dealValue: number | null
    createdAt: Date
  }
  company: {
    name: string
    industry: string | null
    employeeCount: number | null
    revenueBand: string | null
    country: string | null
    businessModel: string | null
  } | null
  events: { type: string; occurredAt: Date; weight: number | null }[]
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

export async function loadLeadBundle(workspaceId: string, leadId: string): Promise<LeadBundle> {
  const lead = await db.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: {
      company: {
        select: {
          name: true,
          industry: true,
          employeeCount: true,
          revenueBand: true,
          country: true,
          businessModel: true,
        },
      },
      events: {
        select: { type: true, occurredAt: true, weight: true },
        orderBy: { occurredAt: 'desc' },
        take: 400,
      },
    },
  })
  if (!lead) throw new Error('Lead not found')
  return {
    lead: {
      id: lead.id,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      title: lead.title,
      status: lead.status,
      source: lead.source,
      dealValue: lead.dealValue,
      createdAt: lead.createdAt,
    },
    company: lead.company,
    events: lead.events,
  }
}

export function dataCompletenessOf(bundle: LeadBundle, requiredFields: string[]): number {
  const available: Record<string, boolean> = {
    email: !!bundle.lead.email,
    phone: !!bundle.lead.phone,
    title: !!bundle.lead.title,
    industry: !!bundle.company?.industry,
    employeeCount: bundle.company?.employeeCount != null,
    revenueBand: !!bundle.company?.revenueBand,
    country: !!bundle.company?.country,
    businessModel: !!bundle.company?.businessModel,
    dealValue: bundle.lead.dealValue != null,
  }
  if (requiredFields.length === 0) return 1
  return requiredFields.filter((f) => available[f]).length / requiredFields.length
}

export interface PipelineResult {
  leadId: string
  fit: FitResult
  intent: IntentResult
  prediction: PredictionResult | null
  predictionSkipped: string | null
  qualification: QualificationResult
  recommendations: RecommendationDraft[]
  trace: TraceStep[]
  durationMs: number
}

function daysSinceLastEvent(events: LeadBundle['events']): number | null {
  if (events.length === 0) return null
  return Math.round((Date.now() - events[0].occurredAt.getTime()) / DAY)
}

function engagementSpan(events: LeadBundle['events']): number | null {
  if (events.length === 0) return null
  const min = events.reduce((a, e) => Math.min(a, e.occurredAt.getTime()), Infinity)
  return Math.round((Date.now() - min) / DAY)
}

export function featureContextOf(
  bundle: LeadBundle,
  fit: FitResult | null,
  intent: IntentResult | null,
  industryMatchTarget: string[],
  completeness: number,
): Parameters<typeof buildFeatureVector>[0] {
  const now = Date.now()
  const last30 = bundle.events.filter((e) => now - e.occurredAt.getTime() <= 30 * DAY)
  return {
    fitScore: fit ? fit.score : null,
    intentScore: intent ? intent.score : null,
    events30d: last30.length,
    pricingVisits30d: last30.filter((e) => e.type === 'PRICING_VISIT').length,
    demoRequested: bundle.events.some((e) => e.type === 'DEMO_REQUEST'),
    daysSinceLastEvent: daysSinceLastEvent(bundle.events),
    engagementSpanDays: engagementSpan(bundle.events),
    industryMatch:
      bundle.company?.industry == null ? null : industryMatchTarget.includes(bundle.company.industry),
    employeeCount: bundle.company?.employeeCount ?? null,
    dealValue: bundle.lead.dealValue ?? null,
    dataCompleteness: completeness,
  }
}

async function getLatestAssessment(
  leadId: string,
  kind: string,
  hash: string,
): Promise<{ payload: unknown; score: number | null } | null> {
  const latest = await db.assessment.findFirst({
    where: { leadId, kind },
    orderBy: { createdAt: 'desc' },
  })
  if (latest && latest.contentHash === hash) {
    return { payload: JSON.parse(latest.payload), score: latest.score }
  }
  return null
}

/**
 * Analytical controller — the deterministic orchestration path.
 * Executes fit → intent (in parallel) → prediction → qualification →
 * recommendations, with content-hash caching, bounded retries, and a
 * structured execution trace persisted as an AgentRun.
 */
export async function runLeadPipeline(
  workspaceId: string,
  leadId: string,
  opts: { trigger?: string; force?: boolean } = {},
): Promise<PipelineResult> {
  const started = Date.now()
  const trace: TraceStep[] = []
  const step = async <T>(
    name: string,
    fn: () => Promise<T>,
    hash?: string,
    force?: boolean,
  ): Promise<{ result: T; cached: boolean }> => {
    if (!force && hash) {
      const hit = await getLatestAssessment(leadId, name, hash)
      if (hit) {
        trace.push({ step: name, status: 'OK', detail: 'Served from validated cache (content hash unchanged)', ms: 0, cached: true })
        return { result: hit.payload as T, cached: true }
      }
    }
    const t0 = Date.now()
    const result = await withRetry(fn)
    trace.push({ step: name, status: 'OK', ms: Date.now() - t0 })
    return { result, cached: false }
  }

  const run = await db.agentRun.create({
    data: {
      workspaceId,
      kind: 'ANALYTICAL',
      trigger: opts.trigger ?? 'manual',
      status: 'RUNNING',
      steps: '[]',
    },
  })

  try {
    // 1. Load context
    const t0 = Date.now()
    const bundle = await loadLeadBundle(workspaceId, leadId)
    trace.push({ step: 'load_context', status: 'OK', ms: Date.now() - t0 })

    const [{ data: icp, version: icpVersion }, { data: intentCfg, version: intentVersion }, { data: thresholds }] =
      await Promise.all([
        getActiveIcp(workspaceId),
        getActiveIntent(workspaceId),
        getQualificationThresholds(workspaceId),
      ])
    const completeness = dataCompletenessOf(bundle, icp.requiredFields)

    // 2. Fit & Intent in parallel (independent operations)
    const fitHash = contentHash({
      kind: 'FIT',
      icpVersion,
      company: bundle.company,
      lead: { dealValue: bundle.lead.dealValue, email: bundle.lead.email, phone: bundle.lead.phone, title: bundle.lead.title },
    })
    const intentHash = contentHash({
      kind: 'INTENT',
      intentVersion,
      nowDay: new Date().toISOString().slice(0, 13), // hourly granularity
      events: bundle.events.map((e) => [e.type, Math.floor(e.occurredAt.getTime() / 60000), e.weight]).sort(),
    })

    const [fitRes, intentRes] = await Promise.all([
      step<FitResult>('FIT', async () => {
        const fit = computeFit(bundle.company ?? { industry: null, employeeCount: null, revenueBand: null, country: null, businessModel: null }, bundle.lead, icp, icpVersion)
        await db.assessment.create({
          data: {
            leadId,
            workspaceId,
            kind: 'FIT',
            score: fit.score,
            version: fit.version,
            payload: JSON.stringify(fit),
            contentHash: fitHash,
          },
        })
        return fit
      }, fitHash, opts.force),
      step<IntentResult>('INTENT', async () => {
        const intent = computeIntent(
          bundle.events.map((e) => ({ type: e.type, occurredAt: e.occurredAt, weightOverride: e.weight })),
          intentCfg,
          intentVersion,
        )
        await db.assessment.create({
          data: {
            leadId,
            workspaceId,
            kind: 'INTENT',
            score: intent.score,
            version: intent.version,
            payload: JSON.stringify(intent),
            contentHash: intentHash,
          },
        })
        return intent
      }, intentHash, opts.force),
    ])

    const fit = fitRes.result
    const intent = intentRes.result

    // 3. Conversion prediction (depends on fit + intent)
    let prediction: PredictionResult | null = null
    let predictionSkipped: string | null = null
    const prodModel = await getProductionModel()
    if (!prodModel) {
      predictionSkipped = 'No production model available — predictions are not fabricated.'
      trace.push({ step: 'PREDICTION', status: 'SKIPPED', detail: predictionSkipped, ms: 0 })
    } else {
      const fctx = featureContextOf(bundle, fit, intent, icp.targetIndustries, completeness)
      const { values, missing } = buildFeatureVector(fctx)
      const predHash = contentHash({ kind: 'PREDICTION', modelId: prodModel.id, values: values.map((v) => Math.round(v * 1000) / 1000) })
      const predRes = await step<PredictionResult>('PREDICTION', async () => {
        const p = predictFromContext(prodModel, values, missing)
        await db.assessment.create({
          data: {
            leadId,
            workspaceId,
            kind: 'PREDICTION',
            score: p.probability,
            version: prodModel.versionTag,
            payload: JSON.stringify(p),
            contentHash: predHash,
          },
        })
        return p
      }, predHash, opts.force)
      prediction = predRes.result
    }

    // 4. Qualification (depends on all above)
    const qualHash = contentHash({
      kind: 'QUALIFICATION',
      thresholdsVersion: thresholds.salesReadyFit,
      fit: fit.score,
      intent: intent.score,
      prob: prediction?.probability ?? null,
      completeness,
    })
    const qualRes = await step<QualificationResult>('QUALIFICATION', async () => {
      const q = computeQualification({
        fit: fit.score,
        intent: intent.score,
        prediction,
        dataCompleteness: completeness,
        thresholds,
      })
      await db.assessment.create({
        data: {
          leadId,
          workspaceId,
          kind: 'QUALIFICATION',
          score: null,
          version: q.version,
          payload: JSON.stringify(q),
          contentHash: qualHash,
        },
      })
      // Persist active qualification if category changed
      const current = await db.qualification.findFirst({
        where: { leadId, isActive: true },
        orderBy: { createdAt: 'desc' },
      })
      if (!current || current.category !== q.category || current.source !== 'AUTO') {
        await db.qualification.updateMany({ where: { leadId, isActive: true }, data: { isActive: false } })
        await db.qualification.create({
          data: {
            leadId,
            workspaceId,
            category: q.category,
            reasons: JSON.stringify(q.reasons),
            source: 'AUTO',
            isActive: true,
          },
        })
      }
      return q
    }, qualHash, opts.force)

    // 5. Recommendations (dedupe against pending)
    const tRec = Date.now()
    const pending = await db.recommendation.findMany({
      where: { leadId, workspaceId, status: 'PENDING' },
      select: { action: true },
    })
    const outcomes = await db.verifiedOutcome.findMany({
      where: { leadId },
      select: { outcome: true, dealValue: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
    })
    const feedbackRows = await db.feedback.findMany({
      where: { workspaceId, kind: 'RECOMMENDATION_RATING' },
      select: { payload: true, rating: true },
      take: 200,
    })
    const effectiveness: Record<string, { accepted: number; dismissed: number }> = {}
    for (const f of feedbackRows) {
      try {
        const p = f.payload ? (JSON.parse(f.payload) as { action?: string; dismissed?: boolean }) : null
        if (!p?.action) continue
        const e = effectiveness[p.action] ?? { accepted: 0, dismissed: 0 }
        if (p.dismissed || (f.rating !== null && f.rating <= 2)) e.dismissed++
        else e.accepted++
        effectiveness[p.action] = e
      } catch {
        // ignore malformed feedback payloads
      }
    }
    const priors = learnPriors(outcomes, effectiveness)
    const drafts = generateRecommendations({
      leadId,
      leadName: bundle.lead.contactName,
      companyName: bundle.company?.name ?? 'Unknown company',
      fit: fit.score,
      intent: intent.score,
      prediction,
      qualification: qualRes.result.category,
      events: bundle.events.slice(0, 100),
      pendingActions: pending.map((p) => p.action),
      missingFields: fit.missing,
      pastOutcomes: outcomes,
      priorActionResults: priors,
    })
    for (const d of drafts) {
      await db.recommendation.create({
        data: {
          leadId,
          workspaceId,
          action: d.action,
          priority: d.priority,
          explanation: d.explanation,
          evidence: JSON.stringify(d.evidence),
          signals: JSON.stringify(d.signals),
          suggestedTiming: d.suggestedTiming,
        },
      })
    }
    trace.push({
      step: 'RECOMMENDATIONS',
      status: 'OK',
      detail: `${drafts.length} generated`,
      ms: Date.now() - tRec,
    })

    const durationMs = Date.now() - started
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', steps: JSON.stringify(trace), finishedAt: new Date(), durationMs },
    })

    return {
      leadId,
      fit,
      intent,
      prediction,
      predictionSkipped,
      qualification: qualRes.result,
      recommendations: drafts,
      trace,
      durationMs,
    }
  } catch (err) {
    const durationMs = Date.now() - started
    trace.push({
      step: 'FAILED',
      status: 'ERROR',
      detail: err instanceof Error ? err.message : String(err),
      ms: durationMs,
    })
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', steps: JSON.stringify(trace), finishedAt: new Date(), durationMs },
    })
    throw err
  }
}

/** Invalidates the model cache after training/activation. */
export function modelCacheChanged(): void {
  invalidateModelCache()
}

export { FEATURE_NAMES }
