import { NextRequest } from 'next/server'
import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getDashboardData } from '@/lib/analytics'
import { llmConfigured } from '@/lib/chat/copilot'

export async function GET(_req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    const [data, llm] = await Promise.all([getDashboardData(ctx.workspaceId), llmConfigured()])
    return okJson({ ...data, llmMode: llm ? 'live' : 'demo' })
  })
}
