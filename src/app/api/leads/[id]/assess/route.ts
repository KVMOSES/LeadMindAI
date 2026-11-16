import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { runLeadPipeline } from '@/lib/engines/pipeline'
import { getLeadDetail } from '@/lib/lead-detail'
import { audit } from '@/lib/audit'

/** Runs the full analytical pipeline: fit → intent → prediction → qualification → recommendations. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = await requireAuth()
    const { id } = await params
    const lead = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
    if (!lead) return errorJson('Lead not found', 404)
    let force = false
    try {
      const body = (await req.json()) as { force?: boolean }
      force = body.force === true
    } catch {
      // no body provided
    }
    const result = await runLeadPipeline(ctx.workspaceId, id, { trigger: 'manual_assess', force })
    await audit(ctx.workspaceId, ctx.userId, 'LEAD_ASSESSED', { leadId: id })
    const detail = await getLeadDetail(ctx.workspaceId, id)
    return okJson({ result, detail })
  })
}
