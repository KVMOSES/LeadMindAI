// LeadMind AI — shared domain types

export type Role = 'ADMIN' | 'MEMBER' | 'VIEWER'

export type QualificationCategory =
  | 'SALES_READY'
  | 'NURTURE_TRACK'
  | 'KEEP_WARM'
  | 'MANUAL_REVIEW'

export type AssessmentKind = 'FIT' | 'INTENT' | 'PREDICTION' | 'QUALIFICATION'

export type RecommendationAction =
  | 'CONTACT_NOW'
  | 'SCHEDULE_DEMO'
  | 'SEND_CONTENT'
  | 'NURTURE'
  | 'REQUEST_INFO'
  | 'REASSESS_FIT'
  | 'MONITOR'
  | 'RE_ENGAGE'

export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

// ── ICP configuration ────────────────────────────────────────────────────────

export interface IcpWeights {
  industry: number
  size: number
  revenue: number
  geo: number
  businessModel: number
  dealValue: number
  completeness: number
}

export interface IcpConfigData {
  targetIndustries: string[]
  employeeRange: { min: number; max: number }
  revenueBands: string[]
  countries: string[]
  businessModels: string[]
  dealValueRange: { min: number; max: number }
  weights: IcpWeights
  requiredFields: string[]
}

// ── Intent configuration ─────────────────────────────────────────────────────

export interface IntentWeights {
  WEBSITE_VISIT: number
  PRICING_VISIT: number
  PRODUCT_VISIT: number
  DEMO_REQUEST: number
  EMAIL_OPEN: number
  EMAIL_CLICK: number
  SOCIAL_ENGAGEMENT: number
  FORM_SUBMIT: number
  NEGATIVE_FEEDBACK: number
  UNSUBSCRIBE: number
}

export interface IntentConfigData {
  weights: IntentWeights
  halfLifeDays: number
  saturationK: number
  maxPerTypePerDay: number
  dedupeMinutes: number
  recencyBoost: { within7d: number; within30d: number }
  inactivityPenalty: { afterDays: number; amount: number }
}

// ── Qualification configuration ──────────────────────────────────────────────

export interface QualificationThresholds {
  salesReadyFit: number
  salesReadyIntent: number
  salesReadyProbability: number
  nurtureFit: number
  keepWarmFit: number
  lowQualityFloor: number
}

// ── Scoring results ──────────────────────────────────────────────────────────

export type FactorImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'

export interface ScoreFactor {
  label: string
  detail: string
  impact: FactorImpact
  /** 0..100 subscore of this dimension */
  subscore?: number
  /** percentage weight of this dimension in the total score */
  weightShare?: number
}

export interface FitResult {
  score: number
  factors: ScoreFactor[]
  missing: string[]
  version: string
  explanation: string
}

export interface IntentEventInfo {
  type: string
  count: number
  effectiveWeight: number
  lastAt: string
}

export interface IntentResult {
  score: number | null
  hasData: boolean
  factors: ScoreFactor[]
  events: IntentEventInfo[]
  version: string
  explanation: string
  lastEventAt: string | null
}

export interface PredictionContribution {
  feature: string
  label: string
  value: string | number
  /** signed contribution in probability points (approximate, marginal) */
  contribution: number
}

export interface PredictionResult {
  probability: number
  decision: 'WILL_CONVERT' | 'WILL_NOT_CONVERT'
  modelId: string
  modelVersion: string
  algorithm: string
  threshold: number
  contributions: PredictionContribution[]
  warnings: string[]
  reliability: string
  features: Record<string, number>
}

export interface QualificationResult {
  category: QualificationCategory
  reasons: string[]
  version: string
}

export interface RecommendationDraft {
  action: RecommendationAction
  priority: Priority
  explanation: string
  evidence: string[]
  signals: string[]
  suggestedTiming: string
}

// ── Agent traces ─────────────────────────────────────────────────────────────

export interface TraceStep {
  step: string
  status: 'OK' | 'SKIPPED' | 'ERROR'
  detail?: string
  ms: number
  cached?: boolean
}

// ── Feature engineering ──────────────────────────────────────────────────────

export interface FeatureMeta {
  name: string
  label: string
}

export interface LeadFeatureContext {
  fitScore: number | null
  intentScore: number | null
  events30d: number
  pricingVisits30d: number
  demoRequested: boolean
  daysSinceLastEvent: number | null
  engagementSpanDays: number | null
  industryMatch: boolean | null
  employeeCount: number | null
  dealValue: number | null
  dataCompleteness: number
}

// ── Chat protocol ────────────────────────────────────────────────────────────

export interface ToolTrace {
  name: string
  args: Record<string, unknown>
  ok: boolean
  summary: string
  ms: number
}

export type ChatMode = 'LLM' | 'DEMO'
