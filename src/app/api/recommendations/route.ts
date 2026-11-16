import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, okJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { ACTION_LABELS } from '@/lib/engines/nba'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    const sp = req.nextUrl.searchParams
    const status = sp.get('status') ?? 'PENDING'
    const priority = sp.get('priority')
    const leadId = sp.get('leadId')
    const recs = await db.recommendation.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status,
        ...(priority ? { priority } : {}),
        ...(leadId ? { leadId } : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 60,
      include: { lead: { include: { company: true } } },
    })
    return okJson({
      items: recs.map((r) => ({
        id: r.id,
        leadId: r.leadId,
        leadName: r.lead.contactName,
        companyName: r.lead.company?.name ?? 'Unknown',
        action: r.action,
        actionLabel: ACTION_LABELS[r.action as keyof typeof ACTION_LABELS] ?? r.action,
        priority: r.priority,
        explanation: r.explanation,
        evidence: safeArr(r.evidence),
        signals: safeArr(r.signals),
        suggestedTiming: r.suggestedTiming,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  })
}

function safeArr(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
