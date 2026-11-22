import { db } from '@/lib/db'

/** Memories attached to a lead + workspace-level approved items (for lead profile view). */
export async function getLeadMemoryForLead(workspaceId: string, leadId: string) {
  const memories = await db.chatMemory.findMany({
    where: { workspaceId, OR: [{ leadId }, { scope: 'WORKSPACE' }] },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: { id: true, scope: true, key: true, value: true, approved: true, updatedAt: true },
  })
  return memories.map((m) => ({
    id: m.id,
    scope: m.scope,
    key: m.key,
    value: m.value,
    approved: m.approved,
    updatedAt: m.updatedAt.toISOString(),
  }))
}
