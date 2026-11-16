import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getLeadRows } from '@/lib/analytics'
import { runLeadPipeline, type TraceStep } from '@/lib/engines/pipeline'
import { audit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    const sp = req.nextUrl.searchParams
    const num = (k: string) => (sp.get(k) !== null ? Number(sp.get(k)) : undefined)
    const result = await getLeadRows(ctx.workspaceId, {
      query: sp.get('query') ?? undefined,
      industry: sp.get('industry') ?? undefined,
      status: sp.get('status') ?? undefined,
      qualification: sp.get('qualification') ?? undefined,
      minFit: num('minFit'),
      maxFit: num('maxFit'),
      minIntent: num('minIntent'),
      maxIntent: num('maxIntent'),
      minProbability: num('minProbability'),
      sort: (sp.get('sort') as 'fit' | undefined) ?? undefined,
      order: (sp.get('order') as 'asc' | 'desc' | undefined) ?? undefined,
      page: num('page') ?? 1,
      pageSize: num('pageSize') ?? 25,
    })
    const facets = await db.company.findMany({
      where: { workspaceId: ctx.workspaceId, industry: { not: null } },
      select: { industry: true },
      distinct: ['industry'],
    })
    return okJson({
      items: result.rows,
      total: result.total,
      page: num('page') ?? 1,
      pageSize: num('pageSize') ?? 25,
      facets: { industries: facets.map((f) => f.industry) },
    })
  })
}

const createSchema = z.object({
  companyName: z.string().min(1).max(120),
  contactName: z.string().min(1).max(120),
  industry: z.string().max(60).optional(),
  employeeCount: z.number().int().min(0).max(1_000_000).optional(),
  revenueBand: z.string().max(20).optional(),
  country: z.string().max(60).optional(),
  businessModel: z.string().max(30).optional(),
  website: z.string().max(160).optional(),
  email: z.string().max(160).optional(),
  title: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  dealValue: z.number().min(0).max(100_000_000).optional(),
  source: z.string().max(30).optional(),
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot create leads', 403)
    const body = createSchema.parse(await req.json())
    let companyId: string | null = null
    const existing = await db.company.findFirst({ where: { workspaceId: ctx.workspaceId, name: body.companyName } })
    if (existing) {
      companyId = existing.id
    } else {
      const company = await db.company.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: body.companyName,
          industry: body.industry ?? null,
          employeeCount: body.employeeCount ?? null,
          revenueBand: body.revenueBand ?? null,
          country: body.country ?? null,
          businessModel: body.businessModel ?? null,
          website: body.website ?? null,
        },
      })
      companyId = company.id
    }
    const lead = await db.lead.create({
      data: {
        workspaceId: ctx.workspaceId,
        companyId,
        contactName: body.contactName,
        email: body.email ?? null,
        title: body.title ?? null,
        phone: body.phone ?? null,
        status: 'NEW',
        source: body.source ?? 'MANUAL',
        dealValue: body.dealValue ?? null,
      },
    })
    await audit(ctx.workspaceId, ctx.userId, 'LEAD_CREATED', { leadId: lead.id, companyName: body.companyName })
    // Immediate first assessment so the UI shows scores right away
    let trace: TraceStep[] | null = null
    try {
      const res = await runLeadPipeline(ctx.workspaceId, lead.id, { trigger: 'lead_created' })
      trace = res.trace
    } catch {
      // assessment failures must not fail creation
    }
    return okJson({ leadId: lead.id, trace })
  })
}
