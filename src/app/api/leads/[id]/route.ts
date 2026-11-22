import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getLeadDetail } from '@/lib/lead-detail'
import { runLeadPipeline } from '@/lib/engines/pipeline'
import { audit } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    const { id } = await params
    const detail = await getLeadDetail(ctx.workspaceId, id)
    if (!detail) return errorJson('Lead not found', 404)
    return okJson({ detail })
  })
}

const patchSchema = z.object({
  contactName: z.string().min(1).max(120).optional(),
  email: z.string().max(160).optional(),
  phone: z.string().max(40).optional(),
  title: z.string().max(120).optional(),
  status: z.enum(['NEW', 'ACTIVE', 'NURTURING', 'QUALIFIED', 'WON', 'LOST', 'UNQUALIFIED']).optional(),
  dealValue: z.number().min(0).max(100_000_000).nullable().optional(),
  industry: z.string().max(60).optional(),
  employeeCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  revenueBand: z.string().max(20).optional(),
  country: z.string().max(60).optional(),
  businessModel: z.string().max(30).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot edit leads', 403)
    const { id } = await params
    const lead = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!lead) return errorJson('Lead not found', 404)
    const body = patchSchema.parse(await req.json())

    const leadPatch: Record<string, unknown> = {}
    const companyPatch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) {
      if (['industry', 'employeeCount', 'revenueBand', 'country', 'businessModel'].includes(k)) companyPatch[k] = v
      else leadPatch[k] = v
    }
    if (Object.keys(leadPatch).length > 0) {
      await db.lead.update({ where: { id }, data: leadPatch })
    }
    if (Object.keys(companyPatch).length > 0 && lead.companyId) {
      await db.company.update({ where: { id: lead.companyId }, data: companyPatch })
    }
    await audit(ctx.workspaceId, ctx.userId, 'LEAD_UPDATED', { leadId: id, patch: body })

    // Data changed → re-run assessment (cache hashes change automatically)
    const result = await runLeadPipeline(ctx.workspaceId, id, { trigger: 'lead_updated' }).catch(() => null)
    const detail = await getLeadDetail(ctx.workspaceId, id)
    return okJson({ detail, trace: result?.trace ?? null })
  })
}
