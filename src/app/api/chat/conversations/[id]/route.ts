import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    const { id } = await params
    const conversation = await db.conversation.findFirst({
      where: { id, workspaceId: ctx.workspaceId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!conversation) return errorJson('Conversation not found', 404)
    return okJson({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        mode: conversation.mode,
        messages: conversation.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolTraces: m.toolTraces ? JSON.parse(m.toolTraces) : [],
          model: m.model,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    })
  })
}

const patchSchema = z.object({ title: z.string().min(1).max(120) })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    const { id } = await params
    const conv = await db.conversation.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!conv) return errorJson('Conversation not found', 404)
    const body = patchSchema.parse(await req.json())
    await db.conversation.update({ where: { id }, data: { title: body.title } })
    return okJson({})
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    const { id } = await params
    await db.conversation.deleteMany({ where: { id, workspaceId: ctx.workspaceId } })
    return okJson({})
  })
}
