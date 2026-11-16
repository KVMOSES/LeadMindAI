import type { FeatureMeta, LeadFeatureContext } from '@/lib/types'
import { makeRng } from './rng'

export const FEATURE_META: FeatureMeta[] = [
  { name: 'fit_score', label: 'Customer fit score' },
  { name: 'intent_score', label: 'Buying intent score' },
  { name: 'intent_missing', label: 'Intent unknown' },
  { name: 'events_30d', label: 'Events (last 30d)' },
  { name: 'pricing_visits_30d', label: 'Pricing visits (30d)' },
  { name: 'demo_requested', label: 'Demo requested' },
  { name: 'days_since_last_event', label: 'Days since last event' },
  { name: 'engagement_span_days', label: 'Engagement span (days)' },
  { name: 'industry_match', label: 'Industry matches ICP' },
  { name: 'log_employees', label: 'Company size (log)' },
  { name: 'log_deal_value', label: 'Deal value (log)' },
  { name: 'data_completeness', label: 'Data completeness' },
]

export const FEATURE_NAMES = FEATURE_META.map((f) => f.name)
export const FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  FEATURE_META.map((f) => [f.name, f.label]),
)

const DAY = 24 * 3600 * 1000

/**
 * Builds the ML feature vector from a lead's analytical context.
 * Missing numeric values fall back to neutral placeholders and are flagged.
 */
export function buildFeatureVector(ctx: LeadFeatureContext): { values: number[]; missing: string[] } {
  const missing: string[] = []
  const now = Date.now()

  const fit = ctx.fitScore ?? 50
  if (ctx.fitScore === null) missing.push('fit_score')
  const intent = ctx.intentScore ?? 0
  const intentMissing = ctx.intentScore === null ? 1 : 0
  if (ctx.intentScore === null) missing.push('intent_score')

  const daysSince = ctx.daysSinceLastEvent === null ? 120 : Math.min(ctx.daysSinceLastEvent, 120)
  if (ctx.daysSinceLastEvent === null) missing.push('days_since_last_event')

  const span = ctx.engagementSpanDays ?? 0

  const values = [
    fit,
    intent,
    intentMissing,
    ctx.events30d,
    ctx.pricingVisits30d,
    ctx.demoRequested ? 1 : 0,
    daysSince,
    Math.min(span, 180),
    ctx.industryMatch === null ? 0 : ctx.industryMatch ? 1 : 0,
    Math.log(1 + (ctx.employeeCount ?? 0)),
    Math.log(1 + (ctx.dealValue ?? 0)),
    ctx.dataCompleteness,
  ]
  if (ctx.employeeCount === null) missing.push('log_employees')
  if (ctx.dealValue === null) missing.push('log_deal_value')
  void now
  void DAY
  return { values, missing }
}

/**
 * Generates a deterministic, clearly-labeled SYNTHETIC training dataset.
 * A latent "quality" variable drives fit, intent and the conversion label so
 * that models can learn realistic relationships. This is demonstration data —
 * it must never be presented as real-world predictive performance.
 */
export interface SyntheticDataset {
  X: number[][]
  y: number[]
}

export function generateSyntheticDataset(n = 560, seed = 42): SyntheticDataset {
  const rng = makeRng(seed)
  const X: number[][] = []
  const y: number[] = []
  for (let i = 0; i < n; i++) {
    const u = rng.normal(0, 1) // latent lead quality
    const industryMatch = rng.bernoulli(1 / (1 + Math.exp(-1.4 * u)))
    const fit = Math.min(100, Math.max(5, 52 + 20 * u + (industryMatch ? 10 : -12) + rng.normal(0, 7)))
    const intent = Math.min(100, Math.max(0, 46 + 24 * u + rng.normal(0, 14)))
    const events30 = Math.max(0, Math.round(2 + 4 * Math.max(0, u) + rng.normal(0, 2.5)))
    const pricing = industryMatch && u > 0.2 ? rng.bernoulli(0.45) : rng.bernoulli(0.1)
    const demo = u > 0.6 ? rng.bernoulli(0.5) : rng.bernoulli(0.08)
    const daysSince = Math.round(Math.max(0, 18 - 6 * u + Math.abs(rng.normal(0, 12))))
    const span = Math.round(Math.max(0, 25 + 18 * u + rng.normal(0, 10)))
    const employees = Math.round(Math.exp(rng.normal(5.9 + 0.45 * u, 0.85)))
    const dealValue = Math.round(Math.exp(rng.normal(10.6 + 0.5 * u, 0.7)))
    const completeness = Math.min(1, Math.max(0.3, 0.85 + rng.normal(0.05, 0.12)))

    const logit =
      -1.35 + 0.030 * (fit - 50) + 0.026 * (intent - 50) + 0.75 * u + 0.5 * demo - 0.006 * Math.max(0, daysSince - 21)
    const p = 1 / (1 + Math.exp(-logit))
    const label = rng.next() < p ? 1 : 0

    X.push([
      fit,
      intent,
      0,
      events30,
      pricing,
      demo,
      Math.min(daysSince, 120),
      Math.min(span, 180),
      industryMatch,
      Math.log(1 + employees),
      Math.log(1 + dealValue),
      completeness,
    ])
    y.push(label)
  }
  return { X, y }
}

export interface DatasetSummary {
  totalRows: number
  syntheticRows: number
  realOutcomeRows: number
  positives: number
  negatives: number
  featureNames: string[]
  isSyntheticDominant: boolean
}
