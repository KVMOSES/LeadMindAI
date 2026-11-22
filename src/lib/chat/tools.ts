import { z } from 'zod'
import { db } from '@/lib/db'
import { getLeadRows, loadScoreMaps, getDashboardData, getTrends, getDataQuality, type LeadRow } from '@/lib/analytics'
import { getActiveIcp, getActiveIntent, getQualificationThresholds, getSetting } from '@/lib/config'
import { getProductionModel } from '@/lib/ml/predict'
import { retrieveKnowledge } from '@/lib/rag'
import { audit } from '@/lib/audit'
import { computeDriftReport } from '@/lib/ml/drift'
import { ACTION_LABELS } from '@/lib/engines/nba'
import type { Role, ToolTrace } from '@/lib/types'

export type { ToolTrace }

const DAY = 24 * 3600 * 1000

export interface ToolContext {
  workspaceId: string
  workspaceName: string
  userId: string
  role: Role
  activeLeadId: string | null
  conversationId: string | null
}

export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
  requiresConfirmation?: boolean
  pendingActionId?: string
  summary?: string
}

export interface ToolDef {
  name: string
  description: string
  parameters: { name: string; type: string; required: boolean; description?: string }[]
  kind: 'read' | 'write-reversible' | 'write-confirm'
  schema: z.ZodTypeAny
  run: (ctx: ToolContext, args: any) => Promise<ToolResult>
}

function denyViewer(ctx: ToolContext): ToolResult | null {
  if (ctx.role === 'VIEWER') {
    return { ok: false, error: 'Your role (VIEWER) does not permit changes. Ask an admin to perform this action.' }
  }
  return null
}

function fmtRow(r: LeadRow) {
  return {
    leadId: r.id,
    contact: r.contactName,
    company: r.companyName,
    industry: r.industry,
    title: r.title,
    fit: r.fit,
    intent: r.intent,
    conversionProbability: r.probability,
    qualification: r.qualification?.category ?? null,
    status: r.status,
    dealValue: r.dealValue,
    lastEventAt: r.lastEventAt,
    topAction: r.topAction,
  }
}

// ── Lead tools ───────────────────────────────────────────────────────────────

const searchLeads: ToolDef = {
  name: 'search_leads',
  description: 'Search workspace leads with filters and sorting. Returns real lead records with their fit, intent, conversion probability and qualification.',
  kind: 'read',
  parameters: [
    { name: 'query', type: 'string', required: false, description: 'Free-text match on contact, company or email' },
    { name: 'industry', type: 'string', required: false, description: 'Filter by industry' },
    { name: 'qualification', type: 'string', required: false, description: 'SALES_READY | NURTURE_TRACK | KEEP_WARM | MANUAL_REVIEW' },
    { name: 'status', type: 'string', required: false, description: 'ACTIVE | NEW | NURTURING | QUALIFIED | WON | LOST' },
    { name: 'minFit', type: 'number', required: false, description: 'Minimum fit score 0-100' },
    { name: 'maxFit', type: 'number', required: false, description: 'Maximum fit score' },
    { name: 'minIntent', type: 'number', required: false, description: 'Minimum intent score 0-100' },
    { name: 'maxIntent', type: 'number', required: false, description: 'Maximum intent score' },
    { name: 'minProbability', type: 'number', required: false, description: 'Minimum predicted conversion probability 0-1' },
    { name: 'sort', type: 'string', required: false, description: 'fit | intent | probability | recent | dealValue | name' },
    { name: 'order', type: 'string', required: false, description: 'asc | desc (default desc)' },
    { name: 'limit', type: 'number', required: false, description: 'Max results (default 8, max 20)' },
  ],
  schema: z.object({
    query: z.string().max(120).optional(),
    industry: z.string().max(60).optional(),
    qualification: z.string().optional(),
    status: z.string().optional(),
    minFit: z.number().min(0).max(100).optional(),
    maxFit: z.number().min(0).max(100).optional(),
    minIntent: z.number().min(0).max(100).optional(),
    maxIntent: z.number().min(0).max(100).optional(),
    minProbability: z.number().min(0).max(1).optional(),
    sort: z.enum(['fit', 'intent', 'probability', 'recent', 'dealValue', 'name']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  run: async (ctx, args) => {
    const { rows } = await getLeadRows(ctx.workspaceId, {
      query: args.query,
      industry: args.industry,
      qualification: args.qualification,
      status: args.status,
      minFit: args.minFit,
      maxFit: args.maxFit,
      minIntent: args.minIntent,
      maxIntent: args.maxIntent,
      minProbability: args.minProbability,
      sort: args.sort,
      order: args.order,
      pageSize: args.limit ?? 8,
    })
    return {
      ok: true,
      data: { count: rows.length, leads: rows.map(fmtRow) },
      summary: `Found ${rows.length} lead(s) matching filters`,
    }
  },
}

async function resolveLead(ctx: ToolContext, leadId?: string, leadName?: string) {
  if (leadId) {
    const lead = await db.lead.findFirst({
      where: { id: leadId, workspaceId: ctx.workspaceId },
      include: { company: true },
    })
    if (lead) return lead
  }
  if (ctx.activeLeadId) {
    const lead = await db.lead.findFirst({
      where: { id: ctx.activeLeadId, workspaceId: ctx.workspaceId },
      include: { company: true },
    })
    if (lead) return lead
  }
  if (leadName) {
    const q = leadName.toLowerCase()
    const candidates = await db.lead.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        OR: [
          { contactName: { contains: leadName, mode: 'insensitive' } },
          { company: { is: { name: { contains: leadName, mode: 'insensitive' } } } },
        ],
      },
      include: { company: true },
      take: 5,
    })
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) {
      const exact = candidates.find(
        (c) => c.contactName.toLowerCase() === q || (c.company?.name.toLowerCase() === q),
      )
      if (exact) return exact
      return { ambiguous: candidates.map((c) => ({ id: c.id, contact: c.contactName, company: c.company?.name })) }
    }
  }
  return null
}

const getLeadDetails: ToolDef = {
  name: 'get_lead_details',
  description: 'Retrieve full details for one lead: company profile, fit, intent, prediction, qualification, pending recommendations and verified outcomes.',
  kind: 'read',
  parameters: [
    { name: 'leadId', type: 'string', required: false, description: 'Lead id (from search results)' },
    { name: 'leadName', type: 'string', required: false, description: 'Contact or company name to resolve' },
  ],
  schema: z.object({ leadId: z.string().optional(), leadName: z.string().optional() }),
  run: async (ctx, args) => {
    const resolved = await resolveLead(ctx, args.leadId, args.leadName)
    if (!resolved) return { ok: false, error: 'No lead matched. Use search_leads first, or provide a leadId.' }
    if ('ambiguous' in resolved) {
      return { ok: false, error: `Multiple leads matched "${args.leadName}": ${resolved.ambiguous.map((a) => `${a.contact} (${a.company})`).join(', ')}. Specify one.`, data: { candidates: resolved.ambiguous } }
    }
    const { rows } = await getLeadRows(ctx.workspaceId, { pageSize: 1 })
    const row = rows.find((r) => r.id === resolved.id)
    const [assessments, recs, outcomes, events] = await Promise.all([
      db.assessment.findMany({ where: { leadId: resolved.id }, orderBy: { createdAt: 'desc' }, take: 12 }),
      db.recommendation.findMany({ where: { leadId: resolved.id, status: 'PENDING' }, orderBy: { priority: 'asc' } }),
      db.verifiedOutcome.findMany({ where: { leadId: resolved.id }, orderBy: { occurredAt: 'desc' } }),
      db.leadEvent.findMany({ where: { leadId: resolved.id }, orderBy: { occurredAt: 'desc' }, take: 15, select: { type: true, occurredAt: true, source: true } }),
    ])
    const latest = { fit: null as unknown, intent: null as unknown, prediction: null as unknown, qualification: null as unknown }
    for (const a of assessments) {
      if (a.kind === 'FIT' && latest.fit === null) latest.fit = JSON.parse(a.payload)
      if (a.kind === 'INTENT' && latest.intent === null) latest.intent = JSON.parse(a.payload)
      if (a.kind === 'PREDICTION' && latest.prediction === null) latest.prediction = JSON.parse(a.payload)
      if (a.kind === 'QUALIFICATION' && latest.qualification === null) latest.qualification = JSON.parse(a.payload)
    }
    return {
      ok: true,
      data: {
        ...fmtRow(row as LeadRow),
        email: resolved.email,
        phone: resolved.phone,
        company: resolved.company
          ? {
              name: resolved.company.name,
              industry: resolved.company.industry,
              employeeCount: resolved.company.employeeCount,
              revenueBand: resolved.company.revenueBand,
              country: resolved.company.country,
              businessModel: resolved.company.businessModel,
            }
          : null,
        latestAssessments: latest,
        pendingRecommendations: recs.map((r) => ({
          id: r.id,
          action: r.action,
          actionLabel: ACTION_LABELS[r.action as keyof typeof ACTION_LABELS] ?? r.action,
          priority: r.priority,
          explanation: r.explanation,
          suggestedTiming: r.suggestedTiming,
        })),
        outcomes: outcomes.map((o) => ({ outcome: o.outcome, dealValue: o.dealValue, occurredAt: o.occurredAt, notes: o.notes })),
        recentEvents: events,
      },
      summary: `Lead details: ${resolved.contactName} (${resolved.company?.name ?? 'unknown'})`,
    }
  },
}

const compareLeads: ToolDef = {
  name: 'compare_leads',
  description: 'Compare 2-5 real leads side by side on fit, intent, conversion probability, qualification and deal value.',
  kind: 'read',
  parameters: [
    { name: 'leadIds', type: 'string[]', required: false, description: 'Array of lead ids' },
    { name: 'leadNames', type: 'string[]', required: false, description: 'Array of contact/company names (supports the active lead)' },
  ],
  schema: z.object({ leadIds: z.array(z.string()).max(5).optional(), leadNames: z.array(z.string()).max(5).optional() }),
  run: async (ctx, args) => {
    const ids: string[] = args.leadIds ?? []
    const names: string[] = args.leadNames ?? []
    const resolvedAll: { id: string; label: string }[] = []
    for (const id of ids) {
      const l = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { company: true } })
      if (l) resolvedAll.push({ id: l.id, label: `${l.contactName} (${l.company?.name})` })
    }
    for (const n of names) {
      const r = await resolveLead(ctx, undefined, n)
      if (r && !('ambiguous' in r)) {
        if (!resolvedAll.some((x) => x.id === r.id)) resolvedAll.push({ id: r.id, label: `${r.contactName} (${r.company?.name})` })
      }
    }
    if (resolvedAll.length === 0 && ctx.activeLeadId) {
      const l = await db.lead.findFirst({ where: { id: ctx.activeLeadId, workspaceId: ctx.workspaceId }, include: { company: true } })
      if (l) resolvedAll.push({ id: l.id, label: `${l.contactName} (${l.company?.name})` })
    }
    if (resolvedAll.length < 2) {
      return { ok: false, error: `Need at least 2 resolvable leads to compare. Resolved ${resolvedAll.length}. Provide leadIds or leadNames.` }
    }
    const capped = resolvedAll.slice(0, 5)
    const scores = await loadScoreMaps(ctx.workspaceId)
    const quals = await db.qualification.findMany({
      where: { workspaceId: ctx.workspaceId, isActive: true, leadId: { in: capped.map((c) => c.id) } },
    })
    const comparison: Record<string, unknown>[] = []
    for (const c of capped) {
      const lead = await db.lead.findUnique({ where: { id: c.id }, include: { company: true } })
      const q = quals.find((x) => x.leadId === c.id)
      comparison.push({
        leadId: c.id,
        label: c.label,
        industry: lead?.company?.industry ?? null,
        fit: scores.fit.get(c.id)?.score ?? null,
        intent: scores.intent.get(c.id)?.score ?? null,
        conversionProbability: scores.pred.get(c.id)?.probability ?? null,
        qualification: q?.category ?? null,
        dealValue: lead?.dealValue ?? null,
        lastEventAt: scores.pred.get(c.id)?.at.toISOString() ?? null,
      })
    }
    return { ok: true, data: { comparison }, summary: `Compared ${capped.length} leads` }
  },
}

const getLeadTimeline: ToolDef = {
  name: 'get_lead_timeline',
  description: 'Retrieve the chronological activity timeline of a lead (engagement events, assessments, recommendations, outcomes).',
  kind: 'read',
  parameters: [
    { name: 'leadId', type: 'string', required: false },
    { name: 'leadName', type: 'string', required: false },
    { name: 'limit', type: 'number', required: false, description: 'Max items (default 20, max 40)' },
  ],
  schema: z.object({ leadId: z.string().optional(), leadName: z.string().optional(), limit: z.number().int().min(1).max(40).optional() }),
  run: async (ctx, args) => {
    const r = await resolveLead(ctx, args.leadId, args.leadName)
    if (!r || 'ambiguous' in r) return { ok: false, error: 'No (unique) lead matched.' }
    const limit = args.limit ?? 20
    const [events, assessments, recs, outcomes] = await Promise.all([
      db.leadEvent.findMany({ where: { leadId: r.id }, orderBy: { occurredAt: 'desc' }, take: limit }),
      db.assessment.findMany({ where: { leadId: r.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      db.recommendation.findMany({ where: { leadId: r.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      db.verifiedOutcome.findMany({ where: { leadId: r.id }, orderBy: { occurredAt: 'desc' }, take: 5 }),
    ])
    const timeline = [
      ...events.map((e) => ({ at: e.occurredAt.toISOString(), kind: 'EVENT', label: e.type, detail: e.source })),
      ...assessments.map((a) => ({ at: a.createdAt.toISOString(), kind: `ASSESSMENT_${a.kind}`, label: a.score !== null ? `score ${a.score}` : 'completed', detail: a.version })),
      ...recs.map((x) => ({ at: x.createdAt.toISOString(), kind: 'RECOMMENDATION', label: `${x.action} (${x.priority})`, detail: x.status })),
      ...outcomes.map((o) => ({ at: o.occurredAt.toISOString(), kind: 'OUTCOME', label: o.outcome, detail: o.dealValue !== null ? `$${o.dealValue}` : null })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limit)
    return { ok: true, data: { leadId: r.id, lead: `${r.contactName} (${r.company?.name})`, timeline }, summary: `Timeline for ${r.contactName}: ${timeline.length} items` }
  },
}

// ── Scoring tools ────────────────────────────────────────────────────────────

const getAssessment: ToolDef = {
  name: 'get_assessment',
  description: 'Retrieve the latest assessment for a lead: FIT, INTENT, PREDICTION or QUALIFICATION. Returns the stored payload with factors and explanations.',
  kind: 'read',
  parameters: [
    { name: 'leadId', type: 'string', required: false },
    { name: 'leadName', type: 'string', required: false },
    { name: 'kind', type: 'string', required: false, description: 'FIT | INTENT | PREDICTION | QUALIFICATION (default: all)' },
    { name: 'history', type: 'boolean', required: false, description: 'Include previous versions of the assessment' },
  ],
  schema: z.object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    kind: z.enum(['FIT', 'INTENT', 'PREDICTION', 'QUALIFICATION']).optional(),
    history: z.boolean().optional(),
  }),
  run: async (ctx, args) => {
    const r = await resolveLead(ctx, args.leadId, args.leadName)
    if (!r || 'ambiguous' in r) return { ok: false, error: 'No (unique) lead matched.' }
    const kinds = args.kind ? [args.kind] : ['FIT', 'INTENT', 'PREDICTION', 'QUALIFICATION']
    const assessments = await db.assessment.findMany({
      where: { leadId: r.id, kind: { in: kinds } },
      orderBy: { createdAt: 'desc' },
      take: args.history ? 20 : 4,
    })
    const out: Record<string, unknown[]> = {}
    for (const k of kinds) out[k] = []
    for (const a of assessments) {
      out[a.kind]?.push({ at: a.createdAt.toISOString(), version: a.version, score: a.score, payload: JSON.parse(a.payload) })
    }
    return { ok: true, data: { leadId: r.id, lead: `${r.contactName} (${r.company?.name})`, assessments: out }, summary: `Assessments for ${r.contactName}` }
  },
}

const explainLeadScoring: ToolDef = {
  name: 'explain_lead_scoring',
  description: 'Full scoring explanation for one lead: fit factors, intent factors, prediction contributions, qualification reasons and warnings.',
  kind: 'read',
  parameters: [
    { name: 'leadId', type: 'string', required: false },
    { name: 'leadName', type: 'string', required: false },
  ],
  schema: z.object({ leadId: z.string().optional(), leadName: z.string().optional() }),
  run: async (ctx, args) => {
    const r = await resolveLead(ctx, args.leadId, args.leadName)
    if (!r || 'ambiguous' in r) return { ok: false, error: 'No (unique) lead matched.' }
    const latest = await db.assessment.findMany({ where: { leadId: r.id }, orderBy: { createdAt: 'desc' }, take: 4 })
    const byKind: Record<string, unknown> = {}
    for (const a of latest) {
      if (!byKind[a.kind]) byKind[a.kind] = JSON.parse(a.payload)
    }
    const qual = await db.qualification.findFirst({ where: { leadId: r.id, isActive: true } })
    return {
      ok: true,
      data: {
        leadId: r.id,
        lead: `${r.contactName} (${r.company?.name})`,
        fit: byKind['FIT'] ?? null,
        intent: byKind['INTENT'] ?? null,
        prediction: byKind['PREDICTION'] ?? null,
        qualification: qual ? { category: qual.category, reasons: safeArr(qual.reasons), source: qual.source } : null,
        note: 'fit and intent come from rule-based engines; prediction comes from the trained ML model with feature contributions.',
      },
      summary: `Scoring explanation for ${r.contactName}`,
    }
  },
}

function safeArr(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// ── Analytics tools ──────────────────────────────────────────────────────────

const getDashboardMetrics: ToolDef = {
  name: 'get_dashboard_metrics',
  description: 'Workspace intelligence metrics: totals, averages, pipeline distribution, model status, industry performance.',
  kind: 'read',
  parameters: [],
  schema: z.object({}),
  run: async (ctx) => {
    const data = await getDashboardData(ctx.workspaceId)
    return { ok: true, data, summary: 'Workspace metrics retrieved' }
  },
}

const getEngagementTrends: ToolDef = {
  name: 'get_engagement_trends',
  description: 'Weekly trend data: new leads, event volume, pricing visits, average intent and fit over the last N weeks.',
  kind: 'read',
  parameters: [{ name: 'weeks', type: 'number', required: false, description: 'Number of weeks (default 10, max 16)' }],
  schema: z.object({ weeks: z.number().int().min(2).max(16).optional() }),
  run: async (ctx, args) => {
    const trends = await getTrends(ctx.workspaceId, args.weeks ?? 10)
    const first = trends.find((t) => t.avgIntent !== null)?.avgIntent
    const last = [...trends].reverse().find((t) => t.avgIntent !== null)?.avgIntent
    const direction =
      first !== undefined && last !== undefined && first !== null && last !== null
        ? last > first
          ? 'RISING'
          : last < first
            ? 'FALLING'
            : 'FLAT'
        : 'INSUFFICIENT_DATA'
    return {
      ok: true,
      data: { trends, intentDirection: direction },
      summary: `Trends over ${args.weeks ?? 10} weeks`,
    }
  },
}

// ── Recommendation tools ─────────────────────────────────────────────────────

const getRecommendations: ToolDef = {
  name: 'get_recommendations',
  description: 'Retrieve next-best-action recommendations with priority, evidence and status.',
  kind: 'read',
  parameters: [
    { name: 'leadId', type: 'string', required: false },
    { name: 'status', type: 'string', required: false, description: 'PENDING | ACCEPTED | COMPLETED | DISMISSED (default PENDING)' },
    { name: 'limit', type: 'number', required: false, description: 'Default 10, max 25' },
  ],
  schema: z.object({ leadId: z.string().optional(), status: z.string().optional(), limit: z.number().int().min(1).max(25).optional() }),
  run: async (ctx, args) => {
    const recs = await db.recommendation.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: args.status ?? 'PENDING',
        ...(args.leadId ? { leadId: args.leadId } : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: args.limit ?? 10,
      include: { lead: { include: { company: true } } },
    })
    return {
      ok: true,
      data: recs.map((r) => ({
        id: r.id,
        leadId: r.leadId,
        lead: `${r.lead.contactName} (${r.lead.company?.name ?? 'unknown'})`,
        action: r.action,
        actionLabel: ACTION_LABELS[r.action as keyof typeof ACTION_LABELS] ?? r.action,
        priority: r.priority,
        explanation: r.explanation,
        evidence: safeArr(r.evidence),
        suggestedTiming: r.suggestedTiming,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      summary: `${recs.length} recommendation(s)`,
    }
  },
}

const updateRecommendationStatus: ToolDef = {
  name: 'update_recommendation_status',
  description: 'Update the status of a recommendation (ACCEPTED, COMPLETED or DISMISSED). This is a reversible internal change and is audit-logged.',
  kind: 'write-reversible',
  parameters: [
    { name: 'recommendationId', type: 'string', required: true },
    { name: 'status', type: 'string', required: true, description: 'ACCEPTED | COMPLETED | DISMISSED' },
  ],
  schema: z.object({ recommendationId: z.string(), status: z.enum(['ACCEPTED', 'COMPLETED', 'DISMISSED']) }),
  run: async (ctx, args) => {
    const denied = denyViewer(ctx)
    if (denied) return denied
    const rec = await db.recommendation.findFirst({ where: { id: args.recommendationId, workspaceId: ctx.workspaceId } })
    if (!rec) return { ok: false, error: 'Recommendation not found in this workspace.' }
    await db.recommendation.update({ where: { id: rec.id }, data: { status: args.status, updatedAt: new Date() } })
    await audit(ctx.workspaceId, ctx.userId, 'RECOMMENDATION_STATUS_UPDATED', { id: rec.id, from: rec.status, to: args.status })
    return { ok: true, data: { id: rec.id, status: args.status }, summary: `Recommendation ${rec.action} → ${args.status}` }
  },
}

// ── Write tools with confirmation ────────────────────────────────────────────

async function createPendingAction(
  ctx: ToolContext,
  toolName: string,
  args: unknown,
  summary: string,
): Promise<ToolResult> {
  if (!ctx.conversationId) return { ok: false, error: 'No conversation context for confirmation.' }
  const pa = await db.pendingAction.create({
    data: {
      conversationId: ctx.conversationId,
      workspaceId: ctx.workspaceId,
      toolName,
      args: JSON.stringify(args),
      summary,
    },
  })
  return { ok: true, requiresConfirmation: true, pendingActionId: pa.id, summary, data: { pendingActionId: pa.id, summary } }
}

const createLead: ToolDef = {
  name: 'create_lead',
  description: 'Create a new lead with a company record. IMPORTANT changes require explicit user confirmation before execution.',
  kind: 'write-confirm',
  parameters: [
    { name: 'companyName', type: 'string', required: true },
    { name: 'contactName', type: 'string', required: true },
    { name: 'industry', type: 'string', required: false },
    { name: 'employeeCount', type: 'number', required: false },
    { name: 'revenueBand', type: 'string', required: false, description: '<1M | 1M-10M | 10M-50M | 50M-100M | 100M+' },
    { name: 'country', type: 'string', required: false },
    { name: 'businessModel', type: 'string', required: false },
    { name: 'email', type: 'string', required: false },
    { name: 'title', type: 'string', required: false },
    { name: 'dealValue', type: 'number', required: false },
    { name: 'source', type: 'string', required: false },
  ],
  schema: z.object({
    companyName: z.string().min(1).max(120),
    contactName: z.string().min(1).max(120),
    industry: z.string().max(60).optional(),
    employeeCount: z.number().int().min(0).max(1_000_000).optional(),
    revenueBand: z.string().max(20).optional(),
    country: z.string().max(60).optional(),
    businessModel: z.string().max(30).optional(),
    email: z.string().max(160).optional(),
    title: z.string().max(120).optional(),
    dealValue: z.number().min(0).max(100_000_000).optional(),
    source: z.string().max(30).optional(),
  }),
  run: async (ctx, args) => {
    const denied = denyViewer(ctx)
    if (denied) return denied
    return createPendingAction(
      ctx,
      'create_lead',
      args,
      `Create lead "${args.contactName}" at "${args.companyName}"${args.industry ? ` (${args.industry})` : ''}`,
    )
  },
}

const updateLead: ToolDef = {
  name: 'update_lead',
  description: 'Update permitted fields of an existing lead (contact info, status, dealValue, company attributes). Requires explicit user confirmation.',
  kind: 'write-confirm',
  parameters: [
    { name: 'leadId', type: 'string', required: true },
    { name: 'patch', type: 'object', required: true, description: 'Fields to change: contactName, email, title, phone, status (ACTIVE|NEW|NURTURING|QUALIFIED), dealValue, industry, employeeCount, revenueBand, country' },
  ],
  schema: z.object({
    leadId: z.string(),
    patch: z.record(z.string(), z.union([z.string(), z.number()])).refine(
      (p) => Object.keys(p).every((k) =>
        ['contactName', 'email', 'title', 'phone', 'status', 'dealValue', 'industry', 'employeeCount', 'revenueBand', 'country'].includes(k),
      ),
      { message: 'patch contains unsupported fields' },
    ),
  }),
  run: async (ctx, args) => {
    const denied = denyViewer(ctx)
    if (denied) return denied
    const lead = await db.lead.findFirst({ where: { id: args.leadId, workspaceId: ctx.workspaceId }, include: { company: true } })
    if (!lead) return { ok: false, error: 'Lead not found in this workspace.' }
    return createPendingAction(
      ctx,
      'update_lead',
      args,
      `Update lead ${lead.contactName} (${lead.company?.name}) fields: ${Object.keys(args.patch).join(', ')}`,
    )
  },
}

const recordOutcome: ToolDef = {
  name: 'record_outcome',
  description: 'Record a verified outcome (WON/LOST/OPEN) for a lead. Real outcomes improve future model training. Requires explicit user confirmation.',
  kind: 'write-confirm',
  parameters: [
    { name: 'leadId', type: 'string', required: true },
    { name: 'outcome', type: 'string', required: true, description: 'WON | LOST | OPEN' },
    { name: 'dealValue', type: 'number', required: false },
    { name: 'notes', type: 'string', required: false },
  ],
  schema: z.object({
    leadId: z.string(),
    outcome: z.enum(['WON', 'LOST', 'OPEN']),
    dealValue: z.number().min(0).optional(),
    notes: z.string().max(500).optional(),
  }),
  run: async (ctx, args) => {
    const denied = denyViewer(ctx)
    if (denied) return denied
    const lead = await db.lead.findFirst({ where: { id: args.leadId, workspaceId: ctx.workspaceId }, include: { company: true } })
    if (!lead) return { ok: false, error: 'Lead not found in this workspace.' }
    return createPendingAction(ctx, 'record_outcome', args, `Record outcome ${args.outcome} for ${lead.contactName} (${lead.company?.name})`)
  },
}

const rememberInformation: ToolDef = {
  name: 'remember_information',
  description: 'Store a durable business fact or preference from the conversation as workspace/lead memory. Requires user confirmation before it becomes part of assistant context.',
  kind: 'write-confirm',
  parameters: [
    { name: 'content', type: 'string', required: true, description: 'The fact to remember (one sentence)' },
    { name: 'leadName', type: 'string', required: false, description: 'Attach to a specific lead' },
    { name: 'scope', type: 'string', required: false, description: 'WORKSPACE (default) | LEAD | USER' },
  ],
  schema: z.object({
    content: z.string().min(3).max(400),
    leadName: z.string().optional(),
    scope: z.enum(['WORKSPACE', 'LEAD', 'USER']).optional(),
  }),
  run: async (ctx, args) => {
    const denied = denyViewer(ctx)
    if (denied) return denied
    return createPendingAction(ctx, 'remember_information', args, `Remember: "${args.content}"`)
  },
}

// ── Model / monitoring tools ─────────────────────────────────────────────────

const getModelStatus: ToolDef = {
  name: 'get_model_status',
  description: 'Current production conversion model: algorithm, version, test metrics (ROC-AUC, PR-AUC, F1), dataset provenance (synthetic vs real).',
  kind: 'read',
  parameters: [],
  schema: z.object({}),
  run: async (ctx) => {
    const model = await getProductionModel()
    if (!model) {
      return { ok: true, data: { production: null, note: 'No production model available. Predictions are disabled until a model is trained and activated.' } }
    }
    return {
      ok: true,
      data: {
        production: {
          id: model.id,
          name: model.name,
          algorithm: model.algorithm,
          versionTag: model.versionTag,
          trainedAt: model.trainedAt.toISOString(),
          threshold: model.threshold,
          testMetrics: model.evalMetrics,
          dataset: { ...model.datasetInfo, note: model.datasetInfo.syntheticRows > model.datasetInfo.realOutcomeRows ? 'SYNTHETIC-dominated demo dataset — metrics are NOT real-world performance' : 'real-outcome dataset' },
          topFeatures: model.featureImportance.slice(0, 5),
        },
      },
      summary: `Production model: ${model.algorithm} ${model.versionTag}`,
    }
  },
}

const getDriftReport: ToolDef = {
  name: 'get_drift_report',
  description: 'Latest feature-drift report (PSI) comparing recent lead features against the training reference distribution.',
  kind: 'read',
  parameters: [],
  schema: z.object({}),
  run: async (ctx) => {
    const latest = await db.driftReport.findFirst({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: 'desc' },
    })
    if (latest) {
      return { ok: true, data: { ...JSON.parse(latest.details), reportGeneratedAt: latest.createdAt.toISOString() } }
    }
    const fresh = await computeDriftReport(ctx.workspaceId)
    return { ok: true, data: { ...fresh, reportGeneratedAt: new Date().toISOString() }, summary: `Drift status: ${fresh.status}` }
  },
}

const getDataQualityReport: ToolDef = {
  name: 'get_data_quality_report',
  description: 'Workspace data-quality problems: missing fields, duplicate emails, leads without events, invalid events, stale leads.',
  kind: 'read',
  parameters: [],
  schema: z.object({}),
  run: async (ctx) => {
    const report = await getDataQuality(ctx.workspaceId)
    return { ok: true, data: report, summary: `${report.issues.length} data quality issue(s)` }
  },
}

// ── Knowledge & memory tools ─────────────────────────────────────────────────

const searchKnowledge: ToolDef = {
  name: 'search_knowledge',
  description: 'Semantic retrieval over the workspace knowledge base (playbooks, policies, product notes, uploaded documents). Returns excerpts with source references.',
  kind: 'read',
  parameters: [
    { name: 'query', type: 'string', required: true },
    { name: 'topK', type: 'number', required: false, description: 'Max excerpts (default 4, max 8)' },
  ],
  schema: z.object({ query: z.string().min(2).max(200), topK: z.number().int().min(1).max(8).optional() }),
  run: async (ctx, args) => {
    const hits = await retrieveKnowledge(ctx.workspaceId, args.query, args.topK ?? 4)
    if (hits.length === 0) {
      return { ok: true, data: { excerpts: [], note: 'No matching knowledge found for this query.' } }
    }
    return {
      ok: true,
      data: {
        excerpts: hits.map((h) => ({ source: h.documentName, excerpt: h.text, relevance: h.score })),
      },
      summary: `${hits.length} knowledge excerpt(s)`,
    }
  },
}

const getLeadMemory: ToolDef = {
  name: 'get_lead_memory',
  description: 'Retrieve stored conversational memory for a lead and the workspace (approved and pending items).',
  kind: 'read',
  parameters: [
    { name: 'leadId', type: 'string', required: false },
    { name: 'leadName', type: 'string', required: false },
  ],
  schema: z.object({ leadId: z.string().optional(), leadName: z.string().optional() }),
  run: async (ctx, args) => {
    const r = args.leadId || args.leadName ? await resolveLead(ctx, args.leadId, args.leadName) : null
    const memories = await db.chatMemory.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(r && !('ambiguous' in r) ? { OR: [{ leadId: r.id }, { scope: 'WORKSPACE' }] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    })
    return {
      ok: true,
      data: memories.map((m) => ({
        id: m.id,
        scope: m.scope,
        key: m.key,
        value: m.value,
        approved: m.approved,
        updatedAt: m.updatedAt.toISOString(),
      })),
      summary: `${memories.length} memory item(s)`,
    }
  },
}

const getWorkspaceConfig: ToolDef = {
  name: 'get_workspace_config',
  description: 'Workspace business configuration: ICP definition, intent weights, qualification thresholds and product info.',
  kind: 'read',
  parameters: [],
  schema: z.object({}),
  run: async (ctx) => {
    const [icp, intent, qual, productInfo] = await Promise.all([
      getActiveIcp(ctx.workspaceId),
      getActiveIntent(ctx.workspaceId),
      getQualificationThresholds(ctx.workspaceId),
      getSetting<{ summary: string }>(ctx.workspaceId, 'product_info'),
    ])
    return {
      ok: true,
      data: {
        icpVersion: icp.version,
        icp: icp.data,
        intentVersion: intent.version,
        intentWeights: intent.data.weights,
        qualification: qual.data,
        productInfo: productInfo?.summary ?? null,
      },
      summary: 'Workspace configuration retrieved',
    }
  },
}

const recordFeedbackTool: ToolDef = {
  name: 'record_feedback',
  description: 'Record sales feedback about a recommendation or a score. Reversible, audit-logged.',
  kind: 'write-reversible',
  parameters: [
    { name: 'leadName', type: 'string', required: false },
    { name: 'leadId', type: 'string', required: false },
    { name: 'kind', type: 'string', required: true, description: 'RECOMMENDATION_RATING | SCORE_DISAGREEMENT | GENERAL' },
    { name: 'rating', type: 'number', required: false, description: '1-5' },
    { name: 'comment', type: 'string', required: false },
    { name: 'action', type: 'string', required: false, description: 'Related recommendation action when rating one' },
  ],
  schema: z.object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    kind: z.enum(['RECOMMENDATION_RATING', 'SCORE_DISAGREEMENT', 'GENERAL']),
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().max(400).optional(),
    action: z.string().max(40).optional(),
  }),
  run: async (ctx, args) => {
    const denied = denyViewer(ctx)
    if (denied) return denied
    const r = args.leadId || args.leadName ? await resolveLead(ctx, args.leadId, args.leadName) : null
    if (args.leadName && (!r || 'ambiguous' in r)) return { ok: false, error: 'Lead not found for feedback.' }
    const fb = await db.feedback.create({
      data: {
        workspaceId: ctx.workspaceId,
        leadId: r && !('ambiguous' in r) ? r.id : null,
        kind: args.kind,
        rating: args.rating ?? null,
        comment: args.comment ?? null,
        payload: args.action ? JSON.stringify({ action: args.action, dismissed: false }) : null,
        createdById: ctx.userId,
      },
    })
    await audit(ctx.workspaceId, ctx.userId, 'FEEDBACK_RECORDED', { id: fb.id, kind: args.kind })
    return { ok: true, data: { id: fb.id }, summary: 'Feedback recorded' }
  },
}

export const TOOLS: ToolDef[] = [
  searchLeads,
  getLeadDetails,
  compareLeads,
  getLeadTimeline,
  getAssessment,
  explainLeadScoring,
  getDashboardMetrics,
  getEngagementTrends,
  getRecommendations,
  updateRecommendationStatus,
  createLead,
  updateLead,
  recordOutcome,
  recordFeedbackTool,
  rememberInformation,
  getModelStatus,
  getDriftReport,
  getDataQualityReport,
  searchKnowledge,
  getLeadMemory,
  getWorkspaceConfig,
]

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]))

export function toolsPromptSection(): string {
  return TOOLS.map((t) => {
    const params = t.parameters
      .map((p) => `${p.name}(${p.type}${p.required ? '' : ', optional'}): ${p.description}`)
      .join('; ')
    return `- ${t.name} [${t.kind}]: ${t.description}${params ? ` Args: ${params}` : ''}`
  }).join('\n')
}

/** Executes a tool with validation, permission checks, logging and a timeout. */
export async function executeTool(
  ctx: ToolContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult & { ms: number }> {
  const tool = TOOL_MAP.get(name)
  if (!tool) {
    return { ok: false, error: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}.`, ms: 0 }
  }
  const started = Date.now()
  try {
    const args = tool.schema.parse(rawArgs ?? {})
    if (tool.kind !== 'read' && ctx.role === 'VIEWER') {
      return { ok: false, error: 'Permission denied: VIEWER role cannot perform changes.', ms: Date.now() - started }
    }
    const result = await Promise.race([
      tool.run(ctx, args),
      new Promise<ToolResult>((_, reject) => setTimeout(() => reject(new Error('Tool execution timed out (10s)')), 10_000)),
    ])
    const ms = Date.now() - started
    // Persist tool execution log
    try {
      await db.toolExecution.create({
        data: {
          conversationId: ctx.conversationId,
          name,
          args: JSON.stringify(args),
          result: JSON.stringify(result.data ?? { error: result.error }),
          status: result.ok ? 'OK' : 'ERROR',
          durationMs: ms,
        },
      })
    } catch {
      // logging must not break execution
    }
    return { ...result, ms }
  } catch (err) {
    const ms = Date.now() - started
    const message = err instanceof z.ZodError
      ? `Invalid arguments for ${name}: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      : err instanceof Error
        ? err.message
        : String(err)
    try {
      await db.toolExecution.create({
        data: { conversationId: ctx.conversationId, name, args: JSON.stringify(rawArgs ?? {}), result: JSON.stringify({ error: message }), status: 'ERROR', durationMs: ms },
      })
    } catch {
      // ignore
    }
    return { ok: false, error: message, ms }
  }
}

export function summarizeResult(result: ToolResult): string {
  if (!result.ok) return result.error ?? 'failed'
  const d = result.data as Record<string, unknown> | undefined
  if (d && typeof d.count === 'number') return `${d.count} item(s)`
  if (result.summary) return result.summary
  return 'completed'
}

export { fmtRow, DAY }
