import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthError } from '@/lib/auth'

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function okJson(data: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: true, ...data })
}

export function errorJson(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status })
}

/** Wraps an API handler with consistent error translation. */
export async function handle<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AuthError) {
      return errorJson(err.message, err.status)
    }
    if (err instanceof ZodError) {
      const msg = err.issues
        .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
        .join('; ')
      return errorJson(`Invalid input — ${msg}`, 400)
    }
    console.error('[api] unhandled error:', err)
    return errorJson('Internal server error', 500)
  }
}
