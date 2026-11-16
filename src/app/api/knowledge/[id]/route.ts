import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { audit } from '@/lib/audit'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot delete knowledge', 403)
    const { id } = await params
    const doc = await db.knowledgeDocument.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!doc) return errorJson('Document not found', 404)
    await db.knowledgeDocument.delete({ where: { id } })
    await audit(ctx.workspaceId, ctx.userId, 'KNOWLEDGE_DELETED', { id, name: doc.name })
    return okJson({})
  })
}
