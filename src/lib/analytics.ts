import { db } from '@/lib/db'
import { contentHash } from '@/lib/hash'
import type { PredictionResult, QualificationCategory } from '@/lib/types'

const DAY = 24 * 3600 * 1000

export interface LeadRow {
  id: string
  contactName: string
  companyName: string
  companyId: string | null
  industry: string | null
  title: string | null
  email: string | null
  phone: string | null
  status: string
  source: string | null
  dealValue: number | null
  employeeCount: number | null
  revenueBand: string | null
  country: string | null
  businessModel: string | null
  createdAt: string
  updatedAt: string
  fit: number | null
  intent: number | null
  probability: number | null
  qualification: { category: QualificationCategory; source: string; reasons: string[] } | null
  lastEventAt: string | null
  eventCount: number
  topAction: string | null
  topActionPriority: string | null
}

interface ScoreMaps {
  fit: Map<string, { score: number | null; at: Date }>
  intent: Map<string, { score: number | null; at: Date }>
  pred: Map<string, { probability: number | null; payload: PredictionResult; at: Date }>
}

export async function loadScoreMaps(workspaceId: string): Promise<ScoreMaps> {
  const assessments = await db.assessment.findMany({
    where: { workspaceId, kind: { in: ['FIT', 'INTENT', 'PREDICTION'] } },
    orderBy: { createdAt: 'desc' },
    take: 3000,
    select: { leadId: true, kind: true, score: true, payload: true, createdAt: true },
  })
  const fit = new Map<string, { score: number | null; at: Date }>()
  const intent = new Map<string, { score: number | null; at: Date }>()
  const pred = new Map<string, { probability: number | null; payload: PredictionResult; at: Date }>()
  for (const a of assessments) {
    if (a.kind === 'FIT' && !fit.has(a.leadId)) fit.set(a.leadId, { score: a.score, at: a.createdAt })
    if (a.kind === 'INTENT' && !intent.has(a.leadId)) intent.set(a.leadId, { score: a.score, at: a.createdAt })
    if (a.kind === 'PREDICTION' && !pred.has(a.leadId)) {
      let probability = a.score
      try {
        pred.set(a.leadId, {
          probability: probability,
          payload: JSON.parse(a.payload) as PredictionResult,
          at: a.createdAt,
        })
      } catch {
        // ignore malformed payloads
      }
    }
  }
  return { fit, intent, pred }
}

export interface LeadFilters {
  query?: string
  industry?: string
  status?: string
  qualification?: string
  minFit?: number
  maxFit?: number
  minIntent?: number
  maxIntent?: number
  minProbability?: number
  sort?: 'fit' | 'intent' | 'probability' | 'recent' | 'dealValue' | 'name'
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export async function getLeadRows(
  workspaceId: string,
  filters: LeadFilters = {},
): Promise<{ rows: LeadRow[]; total: number; allRows: LeadRow[] }> {
  const where: Record<string, unknown> = { workspaceId }
  if (filters.status) where.status = filters.status
  if (filters.query) {
    where.OR = [
      { contactName: { contains: filters.query, mode: 'insensitive' } },
      { email: { contains: filters.query, mode: 'insensitive' } },
      { company: { is: { name: { contains: filters.query, mode: 'insensitive' } } } },
    ]
  }
  const leads = await db.lead.findMany({
    where,
    include: {
      company: true,
      events: { select: { occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 1 },
      _count: { select: { events: true } },
    },
  })
  const scores = await loadScoreMaps(workspaceId)
  const quals = await db.qualification.findMany({
    where: { workspaceId, isActive: true },
    select: { leadId: true, category: true, source: true, reasons: true },
  })
  const qualMap = new Map(quals.map((q) => [q.leadId, q]))
  const recs = await db.recommendation.findMany({
    where: { workspaceId, status: 'PENDING' },
    select: { leadId: true, action: true, priority: true },
  })
  const recMap = new Map<string, { action: string; priority: string }>()
  const prioOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  for (const r of recs) {
    const cur = recMap.get(r.leadId)
    if (!cur || prioOrder[r.priority] < prioOrder[cur.priority]) {
      recMap.set(r.leadId, { action: r.action, priority: r.priority })
    }
  }

  const allRows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    contactName: l.contactName,
    companyName: l.company?.name ?? 'Unknown',
    companyId: l.companyId,
    industry: l.company?.industry ?? null,
    title: l.title,
    email: l.email,
    phone: l.phone,
    status: l.status,
    source: l.source,
    dealValue: l.dealValue,
    employeeCount: l.company?.employeeCount ?? null,
    revenueBand: l.company?.revenueBand ?? null,
    country: l.company?.country ?? null,
    businessModel: l.company?.businessModel ?? null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    fit: scores.fit.get(l.id)?.score ?? null,
    intent: scores.intent.get(l.id)?.score ?? null,
    probability: scores.pred.get(l.id)?.probability ?? null,
    qualification: qualMap.has(l.id)
      ? {
          category: qualMap.get(l.id)!.category as QualificationCategory,
          source: qualMap.get(l.id)!.source,
          reasons: safeParseArray(qualMap.get(l.id)!.reasons),
        }
      : null,
    lastEventAt: l.events[0]?.occurredAt.toISOString() ?? null,
    eventCount: l._count.events,
    topAction: recMap.get(l.id)?.action ?? null,
    topActionPriority: recMap.get(l.id)?.priority ?? null,
  }))

  let rows = allRows
  if (filters.industry) rows = rows.filter((r) => r.industry === filters.industry)
  if (filters.qualification) rows = rows.filter((r) => r.qualification?.category === filters.qualification)
  if (filters.minFit !== undefined) rows = rows.filter((r) => r.fit !== null && r.fit >= filters.minFit!)
  if (filters.maxFit !== undefined) rows = rows.filter((r) => r.fit !== null && r.fit <= filters.maxFit!)
  if (filters.minIntent !== undefined) rows = rows.filter((r) => r.intent !== null && r.intent >= filters.minIntent!)
  if (filters.maxIntent !== undefined) rows = rows.filter((r) => r.intent !== null && r.intent <= filters.maxIntent!)
  if (filters.minProbability !== undefined)
    rows = rows.filter((r) => r.probability !== null && r.probability >= filters.minProbability!)

  const sortKey = filters.sort ?? 'recent'
  const dir = filters.order === 'asc' ? 1 : -1
  rows = [...rows].sort((a, b) => {
    switch (sortKey) {
      case 'fit':
        return ((a.fit ?? -1) - (b.fit ?? -1)) * dir
      case 'intent':
        return ((a.intent ?? -1) - (b.intent ?? -1)) * dir
      case 'probability':
        return ((a.probability ?? -1) - (b.probability ?? -1)) * dir
      case 'dealValue':
        return ((a.dealValue ?? -1) - (b.dealValue ?? -1)) * dir
      case 'name':
        return a.companyName.localeCompare(b.companyName) * dir
      default:
        return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * dir
    }
  })

  const total = rows.length
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 25
  const paged = rows.slice((page - 1) * pageSize, page * pageSize)
  return { rows: paged, total, allRows: rows }
}

function safeParseArray(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function dashboardHashInputs(workspaceId: string): string {
  return contentHash({ workspaceId, hour: new Date().toISOString().slice(0, 13) })
}

export async function getDashboardData(workspaceId: string) {
  const { allRows } = await getLeadRows(workspaceId, { pageSize: 1, page: 1 })
  const active = allRows.filter((r) => !['WON', 'LOST', 'UNQUALIFIED'].includes(r.status))

  const counts = {
    leads: allRows.length,
    activeLeads: active.length,
    salesReady: allRows.filter((r) => r.qualification?.category === 'SALES_READY').length,
    nurture: allRows.filter((r) => r.qualification?.category === 'NURTURE_TRACK').length,
    keepWarm: allRows.filter((r) => r.qualification?.category === 'KEEP_WARM').length,
    manualReview: allRows.filter((r) => r.qualification?.category === 'MANUAL_REVIEW').length,
    predictions: allRows.filter((r) => r.probability !== null).length,
  }
  const withFit = allRows.filter((r) => r.fit !== null)
  const withIntent = allRows.filter((r) => r.intent !== null)
  const averages = {
    fit: withFit.length ? Math.round((withFit.reduce((a, r) => a + r.fit!, 0) / withFit.length) * 10) / 10 : null,
    intent: withIntent.length ? Math.round((withIntent.reduce((a, r) => a + r.intent!, 0) / withIntent.length) * 10) / 10 : null,
  }
  const withProb = allRows.filter((r) => r.probability !== null)
  const conversionEstimate = {
    predictedWinners: withProb.filter((r) => r.probability! >= 0.55).length,
    totalProbability: Math.round(withProb.reduce((a, r) => a + r.probability!, 0) * 10) / 10,
  }

  // Recent activity across events / assessments / outcomes
  const since = new Date(Date.now() - 14 * DAY)
  const [events, recs, outcomes] = await Promise.all([
    db.leadEvent.findMany({
      where: { workspaceId, occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      take: 12,
      include: { lead: { include: { company: true } } },
    }),
    db.recommendation.findMany({
      where: { workspaceId, status: 'PENDING' },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 6,
      include: { lead: { include: { company: true } } },
    }),
    db.verifiedOutcome.findMany({
      where: { workspaceId },
      orderBy: { occurredAt: 'desc' },
      take: 4,
      include: { lead: { include: { company: true } } },
    }),
  ])
  const activity = [
    ...events.map((e) => ({
      id: e.id,
      type: 'EVENT' as const,
      label: `${e.type.replaceAll('_', ' ')} — ${e.lead.company?.name ?? e.lead.contactName}`,
      leadId: e.leadId,
      at: e.occurredAt.toISOString(),
    })),
    ...outcomes.map((o) => ({
      id: o.id,
      type: 'OUTCOME' as const,
      label: `Outcome ${o.outcome} — ${o.lead.company?.name ?? o.lead.contactName}`,
      leadId: o.leadId,
      at: o.occurredAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10)

  const topRecommendations = recs.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    leadName: r.lead.contactName,
    companyName: r.lead.company?.name ?? 'Unknown',
    action: r.action,
    priority: r.priority,
    explanation: r.explanation,
  }))

  const prodModel = await db.modelVersion.findFirst({
    where: { isProduction: true, status: 'PRODUCTION' },
    orderBy: { trainedAt: 'desc' },
  })
  let modelStatus: {
    id: string
    algorithm: string
    versionTag: string
    trainedAt: string
    rocAuc: number | null
    prAuc: number | null
    f1: number | null
  } | null = null
  if (prodModel) {
    const ev = await db.modelEvaluation.findFirst({
      where: { modelVersionId: prodModel.id, split: 'TEST' },
    })
    const m = ev ? JSON.parse(ev.metrics) : null
    modelStatus = {
      id: prodModel.id,
      algorithm: prodModel.algorithm,
      versionTag: prodModel.versionTag,
      trainedAt: prodModel.trainedAt.toISOString(),
      rocAuc: m?.rocAuc ?? null,
      prAuc: m?.prAuc ?? null,
      f1: m?.f1 ?? null,
    }
  }

  // Industry performance
  const byIndustry = new Map<string, { leads: number; fitSum: number; fitN: number; intentSum: number; intentN: number; won: number; lost: number }>()
  for (const r of allRows) {
    const key = r.industry ?? 'Unknown'
    const cur = byIndustry.get(key) ?? { leads: 0, fitSum: 0, fitN: 0, intentSum: 0, intentN: 0, won: 0, lost: 0 }
    cur.leads++
    if (r.fit !== null) {
      cur.fitSum += r.fit
      cur.fitN++
    }
    if (r.intent !== null) {
      cur.intentSum += r.intent
      cur.intentN++
    }
    if (r.status === 'WON') cur.won++
    if (r.status === 'LOST') cur.lost++
    byIndustry.set(key, cur)
  }
  const industries = [...byIndustry.entries()]
    .map(([industry, v]) => ({
      industry,
      leads: v.leads,
      avgFit: v.fitN ? Math.round((v.fitSum / v.fitN) * 10) / 10 : null,
      avgIntent: v.intentN ? Math.round((v.intentSum / v.intentN) * 10) / 10 : null,
      won: v.won,
      lost: v.lost,
      conversionRate: v.won + v.lost > 0 ? Math.round((v.won / (v.won + v.lost)) * 1000) / 1000 : null,
    }))
    .sort((a, b) => b.leads - a.leads)

  return { counts, averages, conversionEstimate, activity, topRecommendations, modelStatus, industries }
}

export async function getTrends(workspaceId: string, weeks = 12) {
  const since = new Date(Date.now() - weeks * 7 * DAY)
  const leads = await db.lead.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    select: { createdAt: true },
  })
  const events = await db.leadEvent.findMany({
    where: { workspaceId, occurredAt: { gte: since } },
    select: { occurredAt: true, type: true },
  })
  const intents = await db.assessment.findMany({
    where: { workspaceId, kind: 'INTENT', score: { not: null }, createdAt: { gte: since } },
    select: { score: true, createdAt: true },
  })
  const fits = await db.assessment.findMany({
    where: { workspaceId, kind: 'FIT', createdAt: { gte: since } },
    select: { score: true, createdAt: true },
  })

  const out: { label: string; newLeads: number; events: number; pricingVisits: number; avgIntent: number | null; avgFit: number | null }[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(Date.now() - (w + 1) * 7 * DAY)
    const end = new Date(Date.now() - w * 7 * DAY)
    const inRange = (d: Date) => d >= start && d < end
    const newLeads = leads.filter((l) => inRange(l.createdAt)).length
    const evs = events.filter((e) => inRange(e.occurredAt))
    const iScores = intents.filter((i) => inRange(i.createdAt)).map((i) => i.score as number)
    const fScores = fits.filter((f) => inRange(f.createdAt)).map((f) => f.score as number)
    out.push({
      label: `W-${w}`,
      newLeads,
      events: evs.length,
      pricingVisits: evs.filter((e) => e.type === 'PRICING_VISIT').length,
      avgIntent: iScores.length ? Math.round((iScores.reduce((a, v) => a + v, 0) / iScores.length) * 10) / 10 : null,
      avgFit: fScores.length ? Math.round((fScores.reduce((a, v) => a + v, 0) / fScores.length) * 10) / 10 : null,
    })
  }
  return out
}

export interface DataQualityReport {
  missingFields: { field: string; count: number; pct: number }[]
  leadsWithoutEvents: number
  staleLeads: number
  duplicateEmails: { email: string; count: number }[]
  invalidEvents: number
  totalLeads: number
  issues: string[]
}

export async function getDataQuality(workspaceId: string): Promise<DataQualityReport> {
  const leads = await db.lead.findMany({
    where: { workspaceId },
    include: {
      company: true,
      _count: { select: { events: true } },
      events: { select: { occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 1 },
    },
  })
  const n = leads.length || 1
  const missing = {
    email: leads.filter((l) => !l.email).length,
    title: leads.filter((l) => !l.title).length,
    phone: leads.filter((l) => !l.phone).length,
    industry: leads.filter((l) => !l.company?.industry).length,
    employeeCount: leads.filter((l) => l.company?.employeeCount == null).length,
    revenueBand: leads.filter((l) => !l.company?.revenueBand).length,
    dealValue: leads.filter((l) => l.dealValue == null).length,
  }
  const emailCounts = new Map<string, number>()
  for (const l of leads) {
    if (l.email) emailCounts.set(l.email.toLowerCase(), (emailCounts.get(l.email.toLowerCase()) ?? 0) + 1)
  }
  const validTypes = new Set([
    'WEBSITE_VISIT', 'PRICING_VISIT', 'PRODUCT_VISIT', 'DEMO_REQUEST', 'EMAIL_OPEN', 'EMAIL_CLICK',
    'SOCIAL_ENGAGEMENT', 'FORM_SUBMIT', 'NEGATIVE_FEEDBACK', 'UNSUBSCRIBE', 'NOTE', 'CONTACTED', 'MEETING', 'MANUAL',
  ])
  const invalidEvents = await db.leadEvent.count({ where: { workspaceId, type: { notIn: [...validTypes] } } })
  const staleLeads = leads.filter((l) => {
    if (l._count.events === 0) return false
    const last = l.events[0]?.occurredAt
    return last ? last < new Date(Date.now() - 60 * DAY) : false
  }).length
  const noEvents = leads.filter((l) => l._count.events === 0).length

  const issues: string[] = []
  if (missing.email > 0) issues.push(`${missing.email} leads are missing an email address.`)
  if (missing.industry > 0) issues.push(`${missing.industry} companies lack industry — fit scoring penalizes these leads.`)
  if (noEvents > 0) issues.push(`${noEvents} leads have no engagement events; intent is unknown for them.`)
  if (invalidEvents > 0) issues.push(`${invalidEvents} events have unrecognized types and are ignored by the intent engine.`)
  for (const [email, count] of emailCounts) {
    if (count > 1) issues.push(`Duplicate email ${email} appears on ${count} leads.`)
  }

  return {
    missingFields: Object.entries(missing).map(([field, count]) => ({ field, count, pct: Math.round((count / n) * 100) })),
    leadsWithoutEvents: noEvents,
    staleLeads,
    duplicateEmails: [...emailCounts.entries()].filter(([, c]) => c > 1).map(([email, count]) => ({ email, count })),
    invalidEvents,
    totalLeads: leads.length,
    issues,
  }
}
