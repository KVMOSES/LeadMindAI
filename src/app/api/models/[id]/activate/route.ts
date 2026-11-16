import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireRole } from '@/lib/auth'
import { invalidateModelCache } from '@/lib/ml/predict'
import { audit } from '@/lib/audit'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireRole(['ADMIN'])
    const { id } = await params
    const mv = await db.modelVersion.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!mv) return errorJson('Model not found', 404)
    if (mv.status === 'FAILED') return errorJson('Cannot activate a failed model', 400)

    await db.modelVersion.updateMany({ where: { workspaceId: ctx.workspaceId, isProduction: true }, data: { isProduction: false, status: 'ARCHIVED' } })
    await db.modelVersion.update({ where: { id }, data: { isProduction: true, status: 'PRODUCTION' } })
    invalidateModelCache()
    await audit(ctx.workspaceId, ctx.userId, 'MODEL_ACTIVATED', { id, algorithm: mv.algorithm, versionTag: mv.versionTag })
    return okJson({ id, algorithm: mv.algorithm, versionTag: mv.versionTag })
  })
}
