import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { llmConfigured } from '@/lib/chat/copilot'
import { getProductionModel } from '@/lib/ml/predict'

export async function GET() {
  return handle(async () => {
    const ctx = await requireAuth()
    const [llm, model] = await Promise.all([llmConfigured(), getProductionModel()])
    return okJson({
      user: { id: ctx.userId, email: ctx.email, name: ctx.name, role: ctx.role },
      workspace: { id: ctx.workspaceId, name: ctx.workspaceName, slug: ctx.workspaceSlug },
      llmMode: llm ? 'live' : 'demo',
      hasProductionModel: !!model,
    })
  })
}
