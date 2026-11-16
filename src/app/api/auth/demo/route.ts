import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, hashPassword } from '@/lib/auth'
import { handle, okJson, errorJson } from '@/lib/http'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { ensureSeed, DEMO_WORKSPACE_SLUG } from '@/lib/seed'

/**
 * Demo mode entry: seeds the full demo environment (idempotent) and opens a
 * session for the demo analyst user.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    const rl = rateLimit(`demo:${ip}`, 6, 60_000)
    if (!rl.allowed) return errorJson('Too many demo entries. Try again shortly.', 429)

    await ensureSeed()
    const workspace = await db.workspace.findUnique({ where: { slug: DEMO_WORKSPACE_SLUG } })
    if (!workspace) return errorJson('Demo seeding failed', 500)
    let user = await db.user.findUnique({ where: { email: 'demo@leadmind.ai' } })
    if (!user) {
      user = await db.user.create({
        data: { email: 'demo@leadmind.ai', name: 'Demo Analyst', passwordHash: hashPassword('demo1234') },
      })
    }
    const membership = await db.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    })
    if (!membership) {
      await db.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: 'ADMIN' } })
    }
    await createSession(user.id)
    await audit(workspace.id, user.id, 'DEMO_MODE_ENTERED', {})
    return okJson({ workspace: { id: workspace.id, name: workspace.name }, mode: 'demo' })
  })
}
