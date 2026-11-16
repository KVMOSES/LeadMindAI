import { db } from '@/lib/db'
import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  return handle(async () => {
    await requireAuth()
    const runs = await db.agentRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 25,
    })
    return okJson({
      runs: runs.map((r) => ({
        id: r.id,
        kind: r.kind,
        trigger: r.trigger,
        status: r.status,
        steps: JSON.parse(r.steps),
        durationMs: r.durationMs,
        startedAt: r.startedAt.toISOString(),
      })),
    })
  })
}
