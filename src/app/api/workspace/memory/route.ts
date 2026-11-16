import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth, requireRole } from '@/lib/auth'
import { audit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAuth()
    const ctx = await requireAuth()
    const scope = req.nextUrl.searchParams.get('scope')
    const memories = await db.chatMemory.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(scope ? { scope } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { lead: { select: { contactName: true, company: { select: { name: true } } } } },
    })
    return okJson({
      memories: memories.map((m) => ({
        id: m.id,
        scope: m.scope,
        key: m.key,
        value: m.value,
        approved: m.approved,
        source: m.source,
        lead: m.lead ? `${m.lead.contactName} (${m.lead.company?.name})` : null,
        updatedAt: m.updatedAt.toISOString(),
      })),
    })
  })
}

const createSchema = z.object({
  content: z.string().min(3).max(400),
  scope: z.enum(['WORKSPACE', 'LEAD', 'USER']),
  leadId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    const body = createSchema.parse(await req.json())
    const memory = await db.chatMemory.create({
      data: {
        workspaceId: ctx.workspaceId,
        scope: body.scope,
        leadId: body.scope === 'LEAD' ? (body.leadId ?? null) : null,
        key: body.content.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
        value: body.content,
        source: 'MANUAL',
        approved: false,
        createdById: ctx.userId,
      },
    })
    return okJson({ id: memory.id })
  })
}

const patchSchema = z.object({ id: z.string(), approved: z.boolean() })

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireRole(['ADMIN'])
    const body = patchSchema.parse(await req.json())
    const memory = await db.chatMemory.findFirst({ where: { id: body.id, workspaceId: ctx.workspaceId } })
    if (!memory) return errorJson('Memory not found', 404)
    await db.chatMemory.update({ where: { id: body.id }, data: { approved: body.approved } })
    await audit(ctx.workspaceId, ctx.userId, body.approved ? 'MEMORY_APPROVED' : 'MEMORY_REVOKED', { id: body.id })
    return okJson({})
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireRole(['ADMIN'])
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return errorJson('id query param required')
    await db.chatMemory.deleteMany({ where: { id, workspaceId: ctx.workspaceId } })
    return okJson({})
  })
}
