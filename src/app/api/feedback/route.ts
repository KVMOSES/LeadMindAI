import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { ACTION_LABELS } from '@/lib/engines/nba'

/** Feedback list + recommendation-effectiveness stats for the learning page. */
export async function GET() {
  return handle(async () => {
    const ctx = await requireAuth()
    const [feedback, recs] = await Promise.all([
      db.feedback.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 60,
        include: { lead: { include: { company: true } } },
      }),
      db.recommendation.findMany({ where: { workspaceId: ctx.workspaceId } }),
    ])
    const effectiveness = new Map<string, { total: number; completed: number; dismissed: number; accepted: number }>()
    for (const r of recs) {
      const e = effectiveness.get(r.action) ?? { total: 0, completed: 0, dismissed: 0, accepted: 0 }
      e.total++
      if (r.status === 'COMPLETED') e.completed++
      if (r.status === 'DISMISSED') e.dismissed++
      if (r.status === 'ACCEPTED') e.accepted++
      effectiveness.set(r.action, e)
    }
    return okJson({
      feedback: feedback.map((f) => ({
        id: f.id,
        kind: f.kind,
        rating: f.rating,
        comment: f.comment,
        lead: f.lead ? `${f.lead.contactName} (${f.lead.company?.name})` : null,
        createdAt: f.createdAt.toISOString(),
      })),
      effectiveness: [...effectiveness.entries()].map(([action, e]) => ({
        action,
        actionLabel: ACTION_LABELS[action as keyof typeof ACTION_LABELS] ?? action,
        ...e,
        completionRate: e.total > 0 ? Math.round((e.completed / e.total) * 100) : 0,
      })),
      overrides: await db.qualification.count({ where: { workspaceId: ctx.workspaceId, source: 'MANUAL' } }),
    })
  })
}

const postSchema = z.object({
  kind: z.enum(['RECOMMENDATION_RATING', 'SCORE_DISAGREEMENT', 'GENERAL']),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
  leadId: z.string().optional(),
  recommendationId: z.string().optional(),
  action: z.string().max(40).optional(),
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    const body = postSchema.parse(await req.json())
    const fb = await db.feedback.create({
      data: {
        workspaceId: ctx.workspaceId,
        leadId: body.leadId ?? null,
        recommendationId: body.recommendationId ?? null,
        kind: body.kind,
        rating: body.rating ?? null,
        comment: body.comment ?? null,
        payload: body.action ? JSON.stringify({ action: body.action, dismissed: (body.rating ?? 5) <= 2 }) : null,
        createdById: ctx.userId,
      },
    })
    await audit(ctx.workspaceId, ctx.userId, 'FEEDBACK_RECORDED', { id: fb.id, kind: body.kind })
    return okJson({ id: fb.id })
  })
}
