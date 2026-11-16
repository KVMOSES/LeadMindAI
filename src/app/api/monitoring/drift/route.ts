import { db } from '@/lib/db'
import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { computeDriftReport } from '@/lib/ml/drift'

export async function GET() {
  return handle(async () => {
    const ctx = await requireAuth()
    const latest = await db.driftReport.findFirst({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: 'desc' },
    })
    if (latest && Date.now() - latest.createdAt.getTime() < 10 * 60_000) {
      return okJson({ report: JSON.parse(latest.details), generatedAt: latest.createdAt.toISOString(), cached: true })
    }
    const fresh = await computeDriftReport(ctx.workspaceId)
    return okJson({ report: fresh, generatedAt: new Date().toISOString(), cached: false })
  })
}
