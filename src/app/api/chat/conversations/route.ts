import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  return handle(async () => {
    const ctx = await requireAuth()
    const conversations = await db.conversation.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
    })
    return okJson({
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        mode: c.mode,
        updatedAt: c.updatedAt.toISOString(),
        firstMessage: c.messages[0]?.content.slice(0, 80) ?? '',
      })),
    })
  })
}

const createSchema = z.object({ title: z.string().max(120).optional() })

export async function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    let title = 'New conversation'
    try {
      const body = createSchema.parse(await req.json())
      if (body.title) title = body.title
    } catch {
      // empty body is fine
    }
    const conversation = await db.conversation.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.userId, title, mode: 'LLM' },
    })
    return okJson({ conversation: { id: conversation.id, title: conversation.title, mode: conversation.mode } })
  })
}
