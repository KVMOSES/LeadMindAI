import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { executePendingAction, cancelPendingAction } from '@/lib/chat/pending'
import { audit } from '@/lib/audit'

const bodySchema = z.object({ action: z.enum(['confirm', 'cancel']) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot execute chat actions', 403)
    const { id } = await params
    const body = bodySchema.parse(await req.json())

    const toolCtx = {
      workspaceId: ctx.workspaceId,
      workspaceName: ctx.workspaceName,
      userId: ctx.userId,
      role: ctx.role,
      activeLeadId: null,
      conversationId: null,
    }

    if (body.action === 'confirm') {
      const result = await executePendingAction(id, toolCtx)
      await audit(ctx.workspaceId, ctx.userId, result.ok ? 'PENDING_ACTION_CONFIRMED' : 'PENDING_ACTION_FAILED', { id })
      return okJson({ result })
    }
    const cancelled = await cancelPendingAction(id, toolCtx)
    if (!cancelled) return errorJson('Pending action not found or already handled', 404)
    return okJson({ cancelled: true })
  })
}
