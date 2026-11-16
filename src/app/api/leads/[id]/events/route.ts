import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { audit } from '@/lib/audit'

const EVENT_TYPES = [
  'WEBSITE_VISIT', 'PRICING_VISIT', 'PRODUCT_VISIT', 'DEMO_REQUEST', 'EMAIL_OPEN', 'EMAIL_CLICK',
  'SOCIAL_ENGAGEMENT', 'FORM_SUBMIT', 'NEGATIVE_FEEDBACK', 'UNSUBSCRIBE', 'CONTACTED', 'MEETING', 'NOTE', 'MANUAL',
] as const

const bodySchema = z.object({
  type: z.enum(EVENT_TYPES),
  occurredAt: z.string().datetime().optional(),
  source: z.string().max(30).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot ingest events', 403)
    const { id } = await params
    const lead = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!lead) return errorJson('Lead not found', 404)
    const body = bodySchema.parse(await req.json())
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date()
    if (occurredAt > new Date()) return errorJson('Event time cannot be in the future', 400)

    // Dedupe: identical type within a 60s window is ignored
    const dup = await db.leadEvent.findFirst({
      where: {
        leadId: id,
        type: body.type,
        occurredAt: { gte: new Date(occurredAt.getTime() - 60_000), lte: new Date(occurredAt.getTime() + 60_000) },
      },
    })
    if (dup) {
      return okJson({ eventId: dup.id, deduplicated: true })
    }
    const event = await db.leadEvent.create({
      data: {
        leadId: id,
        workspaceId: ctx.workspaceId,
        type: body.type,
        source: body.source ?? 'MANUAL',
        occurredAt,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      },
    })
    await db.lead.update({ where: { id }, data: { status: lead.status === 'NEW' ? 'ACTIVE' : lead.status } })
    await audit(ctx.workspaceId, ctx.userId, 'EVENT_INGESTED', { leadId: id, type: body.type })
    return okJson({ eventId: event.id, deduplicated: false })
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    const { id } = await params
    const events = await db.leadEvent.findMany({
      where: { leadId: id, workspaceId: ctx.workspaceId },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    })
    return okJson({ events })
  })
}
