import { db } from '@/lib/db'
import { getLeadRows } from '@/lib/analytics'
import { getLeadMemoryForLead } from '@/lib/chat/tools-shared'
import type { PredictionResult, FitResult, IntentResult, QualificationResult } from '@/lib/types'

export interface LeadDetail {
  lead: Record<string, unknown>
  timeline: { at: string; kind: string; label: string; detail: string | null }[]
  assessments: {
    fit: FitResult | null
    intent: IntentResult | null
    prediction: PredictionResult | null
    qualification: QualificationResult | null
  }
  history: {
    predictions: { at: string; probability: number | null; version: string }[]
    qualifications: { at: string; category: string; source: string; reasons: string[] }[]
    fitScores: { at: string; score: number | null; version: string }[]
  }
  recommendations: Record<string, unknown>[]
  outcomes: Record<string, unknown>[]
  feedbacks: Record<string, unknown>[]
  memories: Record<string, unknown>[]
}

export async function getLeadDetail(workspaceId: string, leadId: string): Promise<LeadDetail | null> {
  const lead = await db.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: { company: true },
  })
  if (!lead) return null

  const { allRows } = await getLeadRows(workspaceId, { pageSize: 1 })
  const row = allRows.find((r) => r.id === leadId)

  const [events, assessments, qualifications, recommendations, outcomes, feedbacks, memories] = await Promise.all([
    db.leadEvent.findMany({ where: { leadId }, orderBy: { occurredAt: 'desc' }, take: 60 }),
    db.assessment.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 40 }),
    db.qualification.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.recommendation.findMany({ where: { leadId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 12 }),
    db.verifiedOutcome.findMany({ where: { leadId }, orderBy: { occurredAt: 'desc' } }),
    db.feedback.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    getLeadMemoryForLead(workspaceId, leadId),
  ])

  const latest: LeadDetail['assessments'] = { fit: null, intent: null, prediction: null, qualification: null }
  const history = { predictions: [], qualifications: [], fitScores: [] } as LeadDetail['history']
  for (const a of assessments) {
    const entry = { at: a.createdAt.toISOString(), score: a.score, version: a.version, payload: JSON.parse(a.payload) }
    if (!latest[a.kind.toLowerCase() as 'fit']) {
      if (a.kind === 'FIT') latest.fit = entry.payload as FitResult
      if (a.kind === 'INTENT') latest.intent = entry.payload as IntentResult
      if (a.kind === 'PREDICTION') latest.prediction = entry.payload as PredictionResult
      if (a.kind === 'QUALIFICATION') latest.qualification = entry.payload as QualificationResult
    }
    if (a.kind === 'PREDICTION') history.predictions.push({ at: entry.at, probability: entry.score, version: entry.version })
    if (a.kind === 'FIT') history.fitScores.push({ at: entry.at, score: entry.score, version: entry.version })
  }
  for (const q of qualifications) {
    history.qualifications.push({
      at: q.createdAt.toISOString(),
      category: q.category,
      source: q.source,
      reasons: safeArr(q.reasons).concat(q.overrideReason ? [`Manual override reason: ${q.overrideReason}`] : []),
    })
  }

  const timeline = [
    ...events.map((e) => ({
      at: e.occurredAt.toISOString(),
      kind: 'EVENT',
      label: e.type,
      detail: e.source ?? null,
    })),
    ...assessments.map((a) => ({
      at: a.createdAt.toISOString(),
      kind: `ASSESSMENT_${a.kind}`,
      label: a.score !== null ? `${a.kind.toLowerCase()}: ${a.score}` : `${a.kind.toLowerCase()} computed`,
      detail: a.version,
    })),
    ...recommendations.map((r) => ({
      at: r.createdAt.toISOString(),
      kind: 'RECOMMENDATION',
      label: `${r.action} (${r.priority})`,
      detail: r.status,
    })),
    ...outcomes.map((o) => ({
      at: o.occurredAt.toISOString(),
      kind: 'OUTCOME',
      label: o.outcome,
      detail: o.dealValue !== null ? `$${o.dealValue.toLocaleString()}` : o.notes,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 80)

  return {
    lead: {
      ...(row ?? {}),
      id: lead.id,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      title: lead.title,
      status: lead.status,
      source: lead.source,
      dealValue: lead.dealValue,
      createdAt: lead.createdAt.toISOString(),
      company: lead.company
        ? {
            id: lead.company.id,
            name: lead.company.name,
            industry: lead.company.industry,
            employeeCount: lead.company.employeeCount,
            revenueBand: lead.company.revenueBand,
            country: lead.company.country,
            businessModel: lead.company.businessModel,
            website: lead.company.website,
          }
        : null,
    },
    timeline,
    assessments: latest,
    history,
    recommendations: recommendations.map((r) => ({
      id: r.id,
      action: r.action,
      priority: r.priority,
      explanation: r.explanation,
      evidence: safeArr(r.evidence),
      signals: safeArr(r.signals),
      status: r.status,
      suggestedTiming: r.suggestedTiming,
      createdAt: r.createdAt.toISOString(),
    })),
    outcomes: outcomes.map((o) => ({
      id: o.id,
      outcome: o.outcome,
      dealValue: o.dealValue,
      notes: o.notes,
      occurredAt: o.occurredAt.toISOString(),
      source: o.source,
    })),
    feedbacks: feedbacks.map((f) => ({
      id: f.id,
      kind: f.kind,
      rating: f.rating,
      comment: f.comment,
      createdAt: f.createdAt.toISOString(),
    })),
    memories,
  }
}

function safeArr(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
