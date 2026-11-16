import type { FitResult, IcpConfigData, ScoreFactor } from '@/lib/types'

export interface FitCompanyInput {
  industry: string | null
  employeeCount: number | null
  revenueBand: string | null
  country: string | null
  businessModel: string | null
}

export interface FitLeadInput {
  dealValue: number | null
  email: string | null
  phone: string | null
  title: string | null
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))

function sizeSubscore(employees: number | null, range: { min: number; max: number }): number {
  if (employees === null) return 0
  if (employees >= range.min && employees <= range.max) return 100
  if (employees < range.min) {
    return clamp(100 - ((range.min - employees) / Math.max(range.min, 1)) * 100)
  }
  return clamp(100 - ((employees - range.max) / Math.max(range.max, 1)) * 80)
}

function dealValueSubscore(
  dealValue: number | null,
  range: { min: number; max: number },
): number {
  if (dealValue === null) return 55 // neutral when unknown
  if (dealValue >= range.min && dealValue <= range.max) return 100
  if (dealValue < range.min) return clamp(100 - ((range.min - dealValue) / Math.max(range.min, 1)) * 90)
  return clamp(100 - ((dealValue - range.max) / Math.max(range.max, 1)) * 60)
}

function matchSubscore(value: string | null, allowed: string[]): {
  score: number
  missing: boolean
} {
  if (!allowed || allowed.length === 0) return { score: 100, missing: false }
  if (!value) return { score: 0, missing: true }
  return allowed.includes(value) ? { score: 100, missing: false } : { score: 0, missing: false }
}

/**
 * Customer Fit engine — measures how well a company matches the workspace
 * Ideal Customer Profile. Entirely independent from buying intent.
 */
export function computeFit(
  company: FitCompanyInput,
  lead: FitLeadInput,
  icp: IcpConfigData,
  icpVersion: string,
): FitResult {
  const w = icp.weights
  const totalWeight =
    w.industry + w.size + w.revenue + w.geo + w.businessModel + w.dealValue + w.completeness ||
    1

  const industry = matchSubscore(company.industry, icp.targetIndustries)
  const revenue = matchSubscore(company.revenueBand, icp.revenueBands)
  const geo = matchSubscore(company.country, icp.countries)
  const bm = matchSubscore(company.businessModel, icp.businessModels)
  const sizeScore = sizeSubscore(company.employeeCount, icp.employeeRange)
  const dvScore = dealValueSubscore(lead.dealValue, icp.dealValueRange)

  const fieldValues: Record<string, boolean> = {
    email: !!lead.email,
    phone: !!lead.phone,
    title: !!lead.title,
    industry: !!company.industry,
    employeeCount: company.employeeCount !== null,
    revenueBand: !!company.revenueBand,
    country: !!company.country,
    businessModel: !!company.businessModel,
    dealValue: lead.dealValue !== null,
  }
  const required = icp.requiredFields ?? []
  const present = required.filter((f) => fieldValues[f]).length
  const completeness = required.length === 0 ? 100 : Math.round((present / required.length) * 100)

  const dims: {
    label: string
    subscore: number
    weight: number
    missing: boolean
    detail: string
  }[] = [
    {
      label: 'Industry match',
      subscore: industry.score,
      weight: w.industry,
      missing: industry.missing,
      detail: company.industry
        ? icp.targetIndustries.includes(company.industry)
          ? `${company.industry} is a target industry`
          : `${company.industry} is outside target industries`
        : 'Industry unknown',
    },
    {
      label: 'Company size',
      subscore: sizeScore,
      weight: w.size,
      missing: company.employeeCount === null,
      detail:
        company.employeeCount === null
          ? 'Employee count unknown'
          : `${company.employeeCount} employees vs target ${icp.employeeRange.min}-${icp.employeeRange.max}`,
    },
    {
      label: 'Revenue band',
      subscore: revenue.score,
      weight: w.revenue,
      missing: revenue.missing,
      detail: company.revenueBand
        ? icp.revenueBands.includes(company.revenueBand)
          ? `${company.revenueBand} is in target revenue bands`
          : `${company.revenueBand} is outside target revenue bands`
        : 'Revenue band unknown',
    },
    {
      label: 'Geography',
      subscore: geo.score,
      weight: w.geo,
      missing: geo.missing,
      detail:
        icp.countries.length === 0
          ? 'No geographic restriction configured'
          : company.country
            ? icp.countries.includes(company.country)
              ? `${company.country} is a preferred market`
              : `${company.country} is not a preferred market`
            : 'Country unknown',
    },
    {
      label: 'Business model',
      subscore: bm.score,
      weight: w.businessModel,
      missing: bm.missing,
      detail: company.businessModel
        ? icp.businessModels.includes(company.businessModel)
          ? `${company.businessModel} is a compatible model`
          : `${company.businessModel} is not a compatible model`
        : 'Business model unknown',
    },
    {
      label: 'Deal value fit',
      subscore: dvScore,
      weight: w.dealValue,
      missing: lead.dealValue === null,
      detail:
        lead.dealValue === null
          ? 'Deal value unknown (neutral)'
          : `$${Math.round(lead.dealValue).toLocaleString()} vs target $${icp.dealValueRange.min.toLocaleString()}-$${icp.dealValueRange.max.toLocaleString()}`,
    },
    {
      label: 'Data completeness',
      subscore: completeness,
      weight: w.completeness,
      missing: completeness < 100,
      detail: `${present}/${required.length} required fields present`,
    },
  ]

  const weightedSum = dims.reduce((acc, d) => acc + d.subscore * d.weight, 0)
  const score = Math.round((weightedSum / totalWeight) * 10) / 10

  const factors: ScoreFactor[] = dims.map((d) => ({
    label: d.label,
    detail: d.detail,
    impact: d.subscore >= 70 ? 'POSITIVE' : d.subscore < 40 ? 'NEGATIVE' : 'NEUTRAL',
    subscore: d.subscore,
    weightShare: Math.round((d.weight / totalWeight) * 100),
  }))

  const missing = dims.filter((d) => d.missing).map((d) => d.label)

  const positives = factors.filter((f) => f.impact === 'POSITIVE').map((f) => f.label)
  const negatives = factors.filter((f) => f.impact === 'NEGATIVE').map((f) => f.label)
  const explanation =
    `Fit score ${score}/100 against ICP ${icpVersion}. ` +
    (positives.length ? `Strengths: ${positives.join(', ')}. ` : '') +
    (negatives.length ? `Limitations: ${negatives.join(', ')}. ` : '') +
    (missing.length ? `Missing information: ${missing.join(', ')}.` : 'All required fields present.')

  return { score, factors, missing, version: icpVersion, explanation }
}
