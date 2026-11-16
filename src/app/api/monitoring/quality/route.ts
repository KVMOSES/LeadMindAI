import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getDataQuality } from '@/lib/analytics'

export async function GET() {
  return handle(async () => {
    const ctx = await requireAuth()
    const report = await getDataQuality(ctx.workspaceId)
    return okJson({ report })
  })
}
