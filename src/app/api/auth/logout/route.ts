import { handle, okJson } from '@/lib/http'
import { destroySession, getAuthContext } from '@/lib/auth'
import { audit } from '@/lib/audit'

export async function POST() {
  return handle(async () => {
    const ctx = await getAuthContext()
    await destroySession()
    if (ctx) await audit(ctx.workspaceId, ctx.userId, 'LOGOUT', {})
    return okJson({})
  })
}
