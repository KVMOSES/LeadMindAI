import { NextRequest } from 'next/server'
import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getSuggestions } from '@/lib/chat/demo'

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAuth()
    const page = req.nextUrl.searchParams.get('page') ?? 'copilot'
    const hasActiveLead = req.nextUrl.searchParams.get('leadId') !== null
    return okJson({ suggestions: getSuggestions(page, hasActiveLead) })
  })
}
