import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson } from '@/lib/http'
import { requireAuth, requireRole } from '@/lib/auth'
import { getActiveIcp, invalidateConfigCaches, INDUSTRIES, REVENUE_BANDS, BUSINESS_MODELS } from '@/lib/config'
import { audit } from '@/lib/audit'

const icpSchema = z.object({
  targetIndustries: z.array(z.string().max(60)).max(20),
  employeeRange: z.object({ min: z.number().int().min(0), max: z.number().int().min(1) }),
  revenueBands: z.array(z.string().max(20)).max(10),
  countries: z.array(z.string().max(60)).max(30),
  businessModels: z.array(z.string().max(30)).max(10),
  dealValueRange: z.object({ min: z.number().min(0), max: z.number().min(1) }),
  weights: z.object({
    industry: z.number().min(0).max(100),
    size: z.number().min(0).max(100),
    revenue: z.number().min(0).max(100),
    geo: z.number().min(0).max(100),
    businessModel: z.number().min(0).max(100),
    dealValue: z.number().min(0).max(100),
    completeness: z.number().min(0).max(100),
  }),
  requiredFields: z.array(z.string().max(30)).max(12),
})

export async function GET() {
  return handle(async () => {
    await requireAuth()
    const active = await getActiveIcp((await requireAuth()).workspaceId)
    return okJson({
      icp: active.data,
      version: active.version,
      versionNumber: active.versionNumber,
      options: { industries: INDUSTRIES, revenueBands: REVENUE_BANDS, businessModels: BUSINESS_MODELS },
    })
  })
}

/** Saving an ICP creates a NEW version and deactivates the old one. */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireRole(['ADMIN'])
    const data = icpSchema.parse(await req.json())
    const latest = await db.icpConfig.findFirst({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { version: 'desc' },
    })
    const nextVersion = (latest?.version ?? 0) + 1
    await db.icpConfig.updateMany({ where: { workspaceId: ctx.workspaceId, isActive: true }, data: { isActive: false } })
    await db.icpConfig.create({
      data: { workspaceId: ctx.workspaceId, version: nextVersion, config: JSON.stringify(data), isActive: true },
    })
    invalidateConfigCaches(ctx.workspaceId)
    await audit(ctx.workspaceId, ctx.userId, 'ICP_CONFIG_UPDATED', { version: nextVersion })
    return okJson({ version: nextVersion })
  })
}
