import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson } from '@/lib/http'
import { requireAuth, requireRole } from '@/lib/auth'
import { getActiveIntent, invalidateConfigCaches } from '@/lib/config'
import { audit } from '@/lib/audit'

const intentSchema = z.object({
  weights: z.record(z.string(), z.number().min(-100).max(100)),
  halfLifeDays: z.number().min(1).max(180),
  saturationK: z.number().min(1).max(200),
  maxPerTypePerDay: z.number().int().min(1).max(100),
  dedupeMinutes: z.number().min(0).max(24 * 60),
  recencyBoost: z.object({ within7d: z.number().min(0).max(50), within30d: z.number().min(0).max(50) }),
  inactivityPenalty: z.object({ afterDays: z.number().min(1).max(365), amount: z.number().min(0).max(50) }),
})

export async function GET() {
  return handle(async () => {
    await requireAuth()
    const ctx = await requireAuth()
    const active = await getActiveIntent(ctx.workspaceId)
    return okJson({ intent: active.data, version: active.version, versionNumber: active.versionNumber })
  })
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireRole(['ADMIN'])
    const data = intentSchema.parse(await req.json())
    const latest = await db.intentConfig.findFirst({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { version: 'desc' },
    })
    const nextVersion = (latest?.version ?? 0) + 1
    await db.intentConfig.updateMany({ where: { workspaceId: ctx.workspaceId, isActive: true }, data: { isActive: false } })
    await db.intentConfig.create({
      data: { workspaceId: ctx.workspaceId, version: nextVersion, config: JSON.stringify(data), isActive: true },
    })
    invalidateConfigCaches(ctx.workspaceId)
    await audit(ctx.workspaceId, ctx.userId, 'INTENT_CONFIG_UPDATED', { version: nextVersion })
    return okJson({ version: nextVersion })
  })
}
