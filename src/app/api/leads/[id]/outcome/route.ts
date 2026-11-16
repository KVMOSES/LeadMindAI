import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getLeadDetail } from '@/lib/lead-detail'
import { audit } from '@/lib/audit'

const bodySchema = z.object({
  outcome: z.enum(['WON', 'LOST', 'OPEN']),
  dealValue: z.number().min(0).max(100_000_000).optional(),
  notes: z.string().max(1000).optional(),
})

/** Records a verified outcome — real training label for future model builds. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot record outcomes', 403)
    const { id } = await params
    const lead = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!lead) return errorJson('Lead not found', 404)
    const body = bodySchema.parse(await req.json())

    const outcome = await db.verifiedOutcome.create({
      data: {
        leadId: id,
        workspaceId: ctx.workspaceId,
        outcome: body.outcome,
        dealValue: body.dealValue ?? null,
        notes: body.notes ?? null,
        occurredAt: new Date(),
        source: 'MANUAL',
        createdById: ctx.userId,
      },
    })
    if (body.outcome !== 'OPEN') {
      await db.lead.update({ where: { id }, data: { status: body.outcome } })
    }
    await audit(ctx.workspaceId, ctx.userId, 'OUTCOME_RECORDED', { leadId: id, outcome: body.outcome, outcomeId: outcome.id })
    const detail = await getLeadDetail(ctx.workspaceId, id)
    return okJson({
      detail,
      note: 'This outcome is now available as a real training label. Retrain the model from the Model Intelligence page to include it.',
    })
  })
}
