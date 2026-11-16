import { cookies } from 'next/headers'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import type { Role } from '@/lib/types'

export const SESSION_COOKIE = 'lm_session'
const SESSION_TTL_DAYS = 30

// ── Password hashing (scrypt) ────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000)
  await db.session.create({ data: { token, userId, expiresAt } })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
  return token
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { token } })
    store.delete(SESSION_COOKIE)
  }
}

export interface AuthContext {
  userId: string
  email: string
  name: string | null
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  role: Role
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: {
        include: { memberships: { include: { workspace: true }, take: 1 } },
      },
    },
  })
  if (!session || session.expiresAt < new Date()) return null
  const membership = session.user.memberships[0]
  if (!membership) return null
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    workspaceId: membership.workspaceId,
    workspaceName: membership.workspace.name,
    workspaceSlug: membership.workspace.slug,
    role: membership.role as Role,
  }
}

export class AuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.status = status
  }
}

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (!ctx) throw new AuthError('Authentication required', 401)
  return ctx
}

export async function requireRole(
  roles: Role[],
): Promise<AuthContext> {
  const ctx = await requireAuth()
  if (!roles.includes(ctx.role)) {
    throw new AuthError(`This action requires role: ${roles.join(' or ')}`, 403)
  }
  return ctx
}
