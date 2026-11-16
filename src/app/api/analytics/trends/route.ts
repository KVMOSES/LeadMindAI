import { NextRequest } from 'next/server'
import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getTrends } from '@/lib/analytics'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    const weeks = Math.min(16, Math.max(2, Number(req.nextUrl.searchParams.get('weeks') ?? 12)))
    const trends = await getTrends(ctx.workspaceId, weeks)
    return okJson({ weeks: trends })
  })
}
