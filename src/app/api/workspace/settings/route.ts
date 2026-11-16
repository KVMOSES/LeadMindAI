import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handle, okJson } from '@/lib/http'
import { requireAuth, requireRole } from '@/lib/auth'
import { getQualificationThresholds, getSetting, putSetting, invalidateConfigCaches } from '@/lib/config'
import { audit } from '@/lib/audit'

const thresholdsSchema = z.object({
  salesReadyFit: z.number().min(0).max(100),
  salesReadyIntent: z.number().min(0).max(100),
  salesReadyProbability: z.number().min(0).max(1),
  nurtureFit: z.number().min(0).max(100),
  keepWarmFit: z.number().min(0).max(100),
  lowQualityFloor: z.number().min(0).max(1),
})

export async function GET() {
  return handle(async () => {
    await requireAuth()
    const ctx = await requireAuth()
    const [thresholds, productInfo] = await Promise.all([
      getQualificationThresholds(ctx.workspaceId),
      getSetting<{ summary: string }>(ctx.workspaceId, 'product_info'),
    ])
    return okJson({ thresholds: thresholds.data, productInfo: productInfo?.summary ?? '' })
  })
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireRole(['ADMIN'])
    const body = z
      .object({
        thresholds: thresholdsSchema.optional(),
        productInfo: z.object({ summary: z.string().max(2000) }).optional(),
      })
      .parse(await req.json())
    if (body.thresholds) {
      await putSetting(ctx.workspaceId, 'qualification_thresholds', body.thresholds)
      await audit(ctx.workspaceId, ctx.userId, 'QUALIFICATION_THRESHOLDS_UPDATED', body.thresholds)
    }
    if (body.productInfo) {
      await putSetting(ctx.workspaceId, 'product_info', body.productInfo)
      await audit(ctx.workspaceId, ctx.userId, 'PRODUCT_INFO_UPDATED', {})
    }
    invalidateConfigCaches(ctx.workspaceId)
    return okJson({})
  })
}
