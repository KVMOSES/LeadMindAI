import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getLeadDetail } from '@/lib/lead-detail'
import { audit } from '@/lib/audit'

const bodySchema = z.object({
  kind: z.enum(['RECOMMENDATION_RATING', 'SCORE_DISAGREEMENT', 'GENERAL']),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
  recommendationId: z.string().optional(),
  action: z.string().max(40).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    const { id } = await params
    const lead = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!lead) return errorJson('Lead not found', 404)
    const body = bodySchema.parse(await req.json())
    await db.feedback.create({
      data: {
        workspaceId: ctx.workspaceId,
        leadId: id,
        recommendationId: body.recommendationId ?? null,
        kind: body.kind,
        rating: body.rating ?? null,
        comment: body.comment ?? null,
        payload: body.action ? JSON.stringify({ action: body.action, dismissed: (body.rating ?? 5) <= 2 }) : null,
        createdById: ctx.userId,
      },
    })
    await audit(ctx.workspaceId, ctx.userId, 'FEEDBACK_RECORDED', { leadId: id, kind: body.kind })
    const detail = await getLeadDetail(ctx.workspaceId, id)
    return okJson({ detail })
  })
}
