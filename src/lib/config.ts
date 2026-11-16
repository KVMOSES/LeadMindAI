import { db } from '@/lib/db'
import { cached, cacheInvalidate } from '@/lib/cache'
import type {
  IcpConfigData,
  IntentConfigData,
  QualificationThresholds,
} from '@/lib/types'

export const DEFAULT_ICP: IcpConfigData = {
  targetIndustries: ['SaaS', 'FinTech', 'Healthcare IT', 'E-commerce', 'Logistics'],
  employeeRange: { min: 50, max: 2000 },
  revenueBands: ['1M-10M', '10M-50M', '50M-100M'],
  countries: ['United States', 'Canada', 'United Kingdom', 'Germany', 'Australia', 'Singapore'],
  businessModels: ['B2B_SAAS', 'ENTERPRISE', 'MARKETPLACE'],
  dealValueRange: { min: 10_000, max: 250_000 },
  weights: {
    industry: 25,
    size: 15,
    revenue: 15,
    geo: 10,
    businessModel: 15,
    dealValue: 10,
    completeness: 10,
  },
  requiredFields: ['email', 'title', 'industry', 'employeeCount'],
}

export const DEFAULT_INTENT: IntentConfigData = {
  weights: {
    WEBSITE_VISIT: 3,
    PRICING_VISIT: 6,
    PRODUCT_VISIT: 4,
    DEMO_REQUEST: 12,
    EMAIL_OPEN: 2,
    EMAIL_CLICK: 4,
    SOCIAL_ENGAGEMENT: 2,
    FORM_SUBMIT: 8,
    NEGATIVE_FEEDBACK: -8,
    UNSUBSCRIBE: -12,
  },
  halfLifeDays: 14,
  saturationK: 25,
  maxPerTypePerDay: 6,
  dedupeMinutes: 45,
  recencyBoost: { within7d: 8, within30d: 4 },
  inactivityPenalty: { afterDays: 21, amount: 12 },
}

export const DEFAULT_QUALIFICATION: QualificationThresholds = {
  salesReadyFit: 65,
  salesReadyIntent: 60,
  salesReadyProbability: 0.55,
  nurtureFit: 55,
  keepWarmFit: 40,
  lowQualityFloor: 0.5,
}

export const REVENUE_BANDS = ['<1M', '1M-10M', '10M-50M', '50M-100M', '100M+']
export const BUSINESS_MODELS = [
  'B2B_SAAS',
  'ENTERPRISE',
  'MARKETPLACE',
  'B2C',
  'AGENCY',
  'OTHER',
]
export const INDUSTRIES = [
  'SaaS',
  'FinTech',
  'Healthcare IT',
  'E-commerce',
  'Logistics',
  'Manufacturing',
  'Media',
  'Education',
  'Energy',
]

// ── Config loading (cached) ──────────────────────────────────────────────────

export async function getActiveIcp(workspaceId: string): Promise<{
  data: IcpConfigData
  version: string
  versionNumber: number
}> {
  return cached(`icp:${workspaceId}`, 30_000, async () => {
    const active = await db.icpConfig.findFirst({
      where: { workspaceId, isActive: true },
      orderBy: { version: 'desc' },
    })
    if (active) {
      return {
        data: JSON.parse(active.config) as IcpConfigData,
        version: `v${active.version}`,
        versionNumber: active.version,
      }
    }
    return { data: DEFAULT_ICP, version: 'default', versionNumber: 0 }
  })
}

export async function getActiveIntent(workspaceId: string): Promise<{
  data: IntentConfigData
  version: string
  versionNumber: number
}> {
  return cached(`intent:${workspaceId}`, 30_000, async () => {
    const active = await db.intentConfig.findFirst({
      where: { workspaceId, isActive: true },
      orderBy: { version: 'desc' },
    })
    if (active) {
      return {
        data: JSON.parse(active.config) as IntentConfigData,
        version: `v${active.version}`,
        versionNumber: active.version,
      }
    }
    return { data: DEFAULT_INTENT, version: 'default', versionNumber: 0 }
  })
}

export async function getQualificationThresholds(
  workspaceId: string,
): Promise<{ data: QualificationThresholds; version: string }> {
  return cached(`qual:${workspaceId}`, 30_000, async () => {
    const s = await db.setting.findUnique({
      where: { workspaceId_key: { workspaceId, key: 'qualification_thresholds' } },
    })
    if (s) {
      return {
        data: JSON.parse(s.value) as QualificationThresholds,
        version: `s${s.updatedAt.getTime()}`,
      }
    }
    return { data: DEFAULT_QUALIFICATION, version: 'default' }
  })
}

export async function getSetting<T>(
  workspaceId: string,
  key: string,
): Promise<T | null> {
  const s = await db.setting.findUnique({
    where: { workspaceId_key: { workspaceId, key } },
  })
  return s ? (JSON.parse(s.value) as T) : null
}

export async function putSetting(
  workspaceId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await db.setting.upsert({
    where: { workspaceId_key: { workspaceId, key } },
    update: { value: JSON.stringify(value) },
    create: { workspaceId, key, value: JSON.stringify(value) },
  })
  cacheInvalidate(`qual:${workspaceId}`)
}

export function invalidateConfigCaches(workspaceId: string): void {
  cacheInvalidate(`icp:${workspaceId}`)
  cacheInvalidate(`intent:${workspaceId}`)
  cacheInvalidate(`qual:${workspaceId}`)
}
