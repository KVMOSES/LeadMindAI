import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, createSession } from '@/lib/auth'
import { handle, okJson, errorJson } from '@/lib/http'
import { rateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { ensureSeed } from '@/lib/seed'

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    const rl = rateLimit(`login:${ip}`, 12, 60_000)
    if (!rl.allowed) return errorJson('Too many login attempts. Try again shortly.', 429)

    const body = bodySchema.parse(await req.json())
    await ensureSeed()
    const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      await audit(null, null, 'LOGIN_FAILED', { email: body.email })
      return errorJson('Invalid email or password', 401)
    }
    await createSession(user.id)
    await audit(null, user.id, 'LOGIN', { email: user.email })
    return okJson({ user: { id: user.id, email: user.email, name: user.name } })
  })
}
