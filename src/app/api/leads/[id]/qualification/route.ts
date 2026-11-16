import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getLeadDetail } from '@/lib/lead-detail'
import { audit } from '@/lib/audit'

const bodySchema = z.object({
  category: z.enum(['SALES_READY', 'NURTURE_TRACK', 'KEEP_WARM', 'MANUAL_REVIEW']),
  reason: z.string().min(3).max(500),
})

/** Authorized manual override of the automatic qualification. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot override qualification', 403)
    const { id } = await params
    const lead = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!lead) return errorJson('Lead not found', 404)
    const body = bodySchema.parse(await req.json())

    await db.qualification.updateMany({ where: { leadId: id, isActive: true }, data: { isActive: false } })
    await db.qualification.create({
      data: {
        leadId: id,
        workspaceId: ctx.workspaceId,
        category: body.category,
        reasons: JSON.stringify([`Manual override by ${ctx.name ?? ctx.email}: ${body.reason}`]),
        source: 'MANUAL',
        overriddenById: ctx.userId,
        overrideReason: body.reason,
        isActive: true,
      },
    })
    await db.lead.update({ where: { id }, data: { status: body.category === 'SALES_READY' ? 'QUALIFIED' : lead.status } })
    await audit(ctx.workspaceId, ctx.userId, 'QUALIFICATION_OVERRIDDEN', { leadId: id, category: body.category, reason: body.reason })
    const detail = await getLeadDetail(ctx.workspaceId, id)
    return okJson({ detail })
  })
}
