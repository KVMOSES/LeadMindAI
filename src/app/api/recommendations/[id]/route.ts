import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { audit } from '@/lib/audit'

const patchSchema = z.object({ status: z.enum(['PENDING', 'ACCEPTED', 'COMPLETED', 'DISMISSED']) })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot update recommendations', 403)
    const { id } = await params
    const rec = await db.recommendation.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!rec) return errorJson('Recommendation not found', 404)
    const body = patchSchema.parse(await req.json())
    await db.recommendation.update({ where: { id }, data: { status: body.status, updatedAt: new Date() } })
    await audit(ctx.workspaceId, ctx.userId, 'RECOMMENDATION_STATUS_UPDATED', { id, from: rec.status, to: body.status, action: rec.action })
    return okJson({ id, status: body.status })
  })
}
