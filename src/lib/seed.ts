import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { DEFAULT_ICP, DEFAULT_INTENT, DEFAULT_QUALIFICATION } from '@/lib/config'
import { computeFit } from '@/lib/engines/icp'
import { computeIntent } from '@/lib/engines/intent'
import { buildFeatureVector } from '@/lib/ml/dataset'
import { buildDemoDataset, trainAllModels, serializeModel, buildReferenceBins } from '@/lib/ml/train'
import { invalidateModelCache } from '@/lib/ml/predict'
import { computeDriftReport } from '@/lib/ml/drift'
import { runLeadPipeline } from '@/lib/engines/pipeline'
import { chunkText } from '@/lib/rag'
import { makeRng } from '@/lib/ml/rng'

const DAY = 24 * 3600 * 1000

export const DEMO_WORKSPACE_SLUG = 'leadmind-demo'
export const DEMO_USER_EMAIL = 'demo@leadmind.ai'
export const DEMO_USER_PASSWORD = 'demo1234'

// ── Deterministic demo corpus ────────────────────────────────────────────────

interface CompanySpec {
  name: string
  industry: string
  employees: number
  revenueBand: string
  country: string
  businessModel: string
  website: string
}

interface LeadSpec {
  company: string
  contactName: string
  email: string | null
  title: string | null
  phone: string | null
  source: string
  dealValue: number | null
  archetype:
    | 'HOT'
    | 'WARM'
    | 'FIT_NO_INTENT'
    | 'INTENT_NO_FIT'
    | 'STALE'
    | 'NEGATIVE'
    | 'MINIMAL'
}

const COMPANIES: CompanySpec[] = [
  { name: 'Nexora Cloud', industry: 'SaaS', employees: 340, revenueBand: '10M-50M', country: 'United States', businessModel: 'B2B_SAAS', website: 'nexora.io' },
  { name: 'Fintavo', industry: 'FinTech', employees: 120, revenueBand: '1M-10M', country: 'United Kingdom', businessModel: 'B2B_SAAS', website: 'fintavo.co' },
  { name: 'Medlink Systems', industry: 'Healthcare IT', employees: 780, revenueBand: '50M-100M', country: 'Germany', businessModel: 'ENTERPRISE', website: 'medlink.de' },
  { name: 'Cartelio', industry: 'E-commerce', employees: 210, revenueBand: '10M-50M', country: 'United States', businessModel: 'MARKETPLACE', website: 'cartelio.com' },
  { name: 'Portline Logistics', industry: 'Logistics', employees: 1500, revenueBand: '50M-100M', country: 'Singapore', businessModel: 'ENTERPRISE', website: 'portline.sg' },
  { name: 'Quantly', industry: 'SaaS', employees: 95, revenueBand: '1M-10M', country: 'Canada', businessModel: 'B2B_SAAS', website: 'quantly.app' },
  { name: 'Brightpath AI', industry: 'SaaS', employees: 62, revenueBand: '1M-10M', country: 'United States', businessModel: 'B2B_SAAS', website: 'brightpath.ai' },
  { name: 'Meridian Insurance', industry: 'FinTech', employees: 2200, revenueBand: '100M+', country: 'United States', businessModel: 'ENTERPRISE', website: 'meridian-ins.com' },
  { name: 'Vitahealth Labs', industry: 'Healthcare IT', employees: 410, revenueBand: '10M-50M', country: 'Australia', businessModel: 'B2B_SAAS', website: 'vitahealth.au' },
  { name: 'Shopvantage', industry: 'E-commerce', employees: 145, revenueBand: '1M-10M', country: 'United Kingdom', businessModel: 'MARKETPLACE', website: 'shopvantage.uk' },
  { name: 'Freightwise', industry: 'Logistics', employees: 620, revenueBand: '10M-50M', country: 'United States', businessModel: 'B2B_SAAS', website: 'freightwise.com' },
  { name: 'Kore Manufacturing', industry: 'Manufacturing', employees: 3400, revenueBand: '100M+', country: 'Germany', businessModel: 'ENTERPRISE', website: 'kore-mfg.de' },
  { name: 'Streamly Media', industry: 'Media', employees: 88, revenueBand: '1M-10M', country: 'Canada', businessModel: 'B2C', website: 'streamly.ca' },
  { name: 'Learnscope', industry: 'Education', employees: 150, revenueBand: '1M-10M', country: 'United States', businessModel: 'B2B_SAAS', website: 'learnscope.edu' },
  { name: 'Voltgrid Energy', industry: 'Energy', employees: 1100, revenueBand: '50M-100M', country: 'Singapore', businessModel: 'ENTERPRISE', website: 'voltgrid.sg' },
  { name: 'Parcelhub', industry: 'Logistics', employees: 240, revenueBand: '10M-50M', country: 'United Kingdom', businessModel: 'MARKETPLACE', website: 'parcelhub.uk' },
  { name: 'Paycircuit', industry: 'FinTech', employees: 300, revenueBand: '10M-50M', country: 'United States', businessModel: 'B2B_SAAS', website: 'paycircuit.io' },
  { name: 'Careloop Health', industry: 'Healthcare IT', employees: 75, revenueBand: '1M-10M', country: 'United States', businessModel: 'B2B_SAAS', website: 'careloop.health' },
  { name: 'Tradeflare', industry: 'E-commerce', employees: 95, revenueBand: '1M-10M', country: 'Australia', businessModel: 'MARKETPLACE', website: 'tradeflare.au' },
  { name: 'Atlasform', industry: 'SaaS', employees: 480, revenueBand: '10M-50M', country: 'Germany', businessModel: 'B2B_SAAS', website: 'atlasform.io' },
  { name: 'Corely Ops', industry: 'SaaS', employees: 55, revenueBand: '1M-10M', country: 'Canada', businessModel: 'AGENCY', website: 'corelyops.com' },
  { name: 'Retailyantra', industry: 'E-commerce', employees: 320, revenueBand: '10M-50M', country: 'Singapore', businessModel: 'MARKETPLACE', website: 'retailyantra.sg' },
  { name: 'Safepay Direct', industry: 'FinTech', employees: 880, revenueBand: '50M-100M', country: 'United States', businessModel: 'ENTERPRISE', website: 'safepaydirect.com' },
  { name: 'Gridlogix', industry: 'Energy', employees: 130, revenueBand: '1M-10M', country: 'Germany', businessModel: 'B2B_SAAS', website: 'gridlogix.de' },
  { name: 'Papercut Studios', industry: 'Media', employees: 40, revenueBand: '<1M', country: 'United States', businessModel: 'B2C', website: 'papercut.studio' },
  { name: 'Movable Freight', industry: 'Logistics', employees: 95, revenueBand: '1M-10M', country: 'Australia', businessModel: 'B2B_SAAS', website: 'movablefreight.au' },
]

const LEADS: LeadSpec[] = [
  { company: 'Nexora Cloud', contactName: 'Sarah Mitchell', email: 'sarah.mitchell@nexora.io', title: 'VP Revenue Operations', phone: '+1 415 555 0132', source: 'WEBSITE', dealValue: 84000, archetype: 'HOT' },
  { company: 'Fintavo', contactName: 'James Okafor', email: 'j.okafor@fintavo.co', title: 'Head of Growth', phone: '+44 20 7946 0812', source: 'REFERRAL', dealValue: 56000, archetype: 'HOT' },
  { company: 'Portline Logistics', contactName: 'Mei Ling Chen', email: 'ml.chen@portline.sg', title: 'Director of Digital', phone: '+65 6555 2231', source: 'EVENT', dealValue: 145000, archetype: 'HOT' },
  { company: 'Paycircuit', contactName: 'Derek Alvarez', email: 'derek@paycircuit.io', title: 'COO', phone: '+1 646 555 9021', source: 'OUTBOUND', dealValue: 96000, archetype: 'HOT' },
  { company: 'Medlink Systems', contactName: 'Anna Weber', email: 'a.weber@medlink.de', title: 'IT Procurement Lead', phone: '+49 30 555 7781', source: 'WEBSITE', dealValue: 120000, archetype: 'WARM' },
  { company: 'Cartelio', contactName: 'Tom Bradley', email: 'tom.bradley@cartelio.com', title: 'Product Manager', phone: null, source: 'WEBSITE', dealValue: 48000, archetype: 'WARM' },
  { company: 'Vitahealth Labs', contactName: 'Rachel Kim', email: 'rachel.kim@vitahealth.au', title: 'CTO', phone: '+61 2 5550 8834', source: 'PARTNER', dealValue: 72000, archetype: 'WARM' },
  { company: 'Freightwise', contactName: 'Marcus Johnson', email: 'mjohnson@freightwise.com', title: 'VP Operations', phone: '+1 312 555 4410', source: 'EVENT', dealValue: 66000, archetype: 'WARM' },
  { company: 'Shopvantage', contactName: 'Priya Sharma', email: 'priya@shopvantage.uk', title: 'E-commerce Director', phone: null, source: 'WEBSITE', dealValue: 39000, archetype: 'WARM' },
  { company: 'Quantly', contactName: 'Eric DOconnell', email: 'eric@quantly.app', title: 'CEO', phone: '+1 604 555 7789', source: 'OUTBOUND', dealValue: 28000, archetype: 'WARM' },
  { company: 'Atlasform', contactName: 'Klaus Berger', email: 'k.berger@atlasform.io', title: 'Head of IT', phone: '+49 89 555 3320', source: 'WEBSITE', dealValue: 88000, archetype: 'FIT_NO_INTENT' },
  { company: 'Safepay Direct', contactName: 'Laura Bennett', email: 'l.bennett@safepaydirect.com', title: 'SVP Technology', phone: '+1 212 555 6620', source: 'REFERRAL', dealValue: 190000, archetype: 'FIT_NO_INTENT' },
  { company: 'Parcelhub', contactName: 'Oliver Grant', email: 'oliver.grant@parcelhub.uk', title: 'Operations Lead', phone: null, source: 'WEBSITE', dealValue: 44000, archetype: 'FIT_NO_INTENT' },
  { company: 'Kore Manufacturing', contactName: 'Hans Mueller', email: 'h.mueller@kore-mfg.de', title: 'Digital Transformation Lead', phone: '+49 40 555 9902', source: 'OUTBOUND', dealValue: 220000, archetype: 'INTENT_NO_FIT' },
  { company: 'Streamly Media', contactName: 'Chloe Dubois', email: 'chloe@streamly.ca', title: 'Monetization Manager', phone: null, source: 'WEBSITE', dealValue: 15000, archetype: 'INTENT_NO_FIT' },
  { company: 'Voltgrid Energy', contactName: 'Arjun Nair', email: 'a.nair@voltgrid.sg', title: 'Head of Innovation', phone: '+65 6555 8117', source: 'EVENT', dealValue: 175000, archetype: 'INTENT_NO_FIT' },
  { company: 'Brightpath AI', contactName: 'Natalie Roberts', email: 'natalie@brightpath.ai', title: 'Founder', phone: '+1 415 555 7712', source: 'WEBSITE', dealValue: 24000, archetype: 'STALE' },
  { company: 'Meridian Insurance', contactName: 'Robert Hayes', email: 'r.hayes@meridian-ins.com', title: 'VP Digital', phone: '+1 917 555 3311', source: 'EVENT', dealValue: 165000, archetype: 'STALE' },
  { company: 'Retailyantra', contactName: 'Aditi Rao', email: 'aditi@retailyantra.sg', title: 'Growth Lead', phone: null, source: 'IMPORT', dealValue: 52000, archetype: 'STALE' },
  { company: 'Learnscope', contactName: 'Daniel Foster', email: 'dan.foster@learnscope.edu', title: 'Program Director', phone: '+1 303 555 2280', source: 'WEBSITE', dealValue: 31000, archetype: 'NEGATIVE' },
  { company: 'Corely Ops', contactName: 'Mia Santos', email: 'mia@corelyops.com', title: 'Managing Partner', phone: null, source: 'OUTBOUND', dealValue: 18000, archetype: 'NEGATIVE' },
  { company: 'Papercut Studios', contactName: 'Leo Martin', email: null, title: null, phone: null, source: 'IMPORT', dealValue: null, archetype: 'MINIMAL' },
  { company: 'Gridlogix', contactName: 'Sofia Eriksson', email: 'sofia@gridlogix.de', title: null, phone: null, source: 'IMPORT', dealValue: 41000, archetype: 'MINIMAL' },
  { company: 'Careloop Health', contactName: 'Grace Liu', email: 'grace.liu@careloop.health', title: 'Clinical Ops Lead', phone: '+1 206 555 6601', source: 'WEBSITE', dealValue: 58000, archetype: 'HOT' },
  { company: 'Movable Freight', contactName: 'Ivan Petrov', email: 'ivan@movablefreight.au', title: 'Fleet Manager', phone: null, source: 'MANUAL', dealValue: 33000, archetype: 'WARM' },
  { company: 'Tradeflare', contactName: 'Emma Walsh', email: 'emma.walsh@tradeflare.au', title: 'Marketplace Lead', phone: '+61 3 5550 1140', source: 'WEBSITE', dealValue: 47000, archetype: 'WARM' },
]

function eventsForArchetype(archetype: LeadSpec['archetype'], now: number, rng: ReturnType<typeof makeRng>): { type: string; daysAgo: number; source: string }[] {
  const ev: { type: string; daysAgo: number; source: string }[] = []
  const push = (type: string, daysAgo: number, source = 'WEB') => ev.push({ type, daysAgo, source })
  switch (archetype) {
    case 'HOT':
      push('WEBSITE_VISIT', 1 + rng.int(0, 2))
      push('PRICING_VISIT', 1 + rng.int(0, 2))
      push('DEMO_REQUEST', 2 + rng.int(0, 5), 'FORM')
      push('PRICING_VISIT', 3 + rng.int(0, 4))
      push('PRODUCT_VISIT', 4 + rng.int(0, 3))
      push('EMAIL_CLICK', 5 + rng.int(0, 4), 'EMAIL')
      push('WEBSITE_VISIT', 7 + rng.int(0, 5))
      push('PRICING_VISIT', 9 + rng.int(0, 6))
      push('PRODUCT_VISIT', 10 + rng.int(0, 8))
      push('FORM_SUBMIT', 12 + rng.int(0, 8), 'FORM')
      push('EMAIL_OPEN', 14 + rng.int(0, 10), 'EMAIL')
      push('WEBSITE_VISIT', 18 + rng.int(0, 12))
      push('SOCIAL_ENGAGEMENT', 22 + rng.int(0, 10), 'SOCIAL')
      push('EMAIL_OPEN', 28 + rng.int(0, 10), 'EMAIL')
      push('WEBSITE_VISIT', 32 + rng.int(0, 12))
      break
    case 'WARM':
      push('WEBSITE_VISIT', 2 + rng.int(0, 6))
      push('PRODUCT_VISIT', 5 + rng.int(0, 8))
      push('EMAIL_OPEN', 8 + rng.int(0, 8), 'EMAIL')
      push('WEBSITE_VISIT', 12 + rng.int(0, 10))
      push('EMAIL_CLICK', 16 + rng.int(0, 10), 'EMAIL')
      push('PRICING_VISIT', 20 + rng.int(0, 12))
      push('SOCIAL_ENGAGEMENT', 26 + rng.int(0, 12), 'SOCIAL')
      push('WEBSITE_VISIT', 34 + rng.int(0, 16))
      break
    case 'FIT_NO_INTENT':
      push('WEBSITE_VISIT', 45 + rng.int(0, 25))
      push('EMAIL_OPEN', 60 + rng.int(0, 20), 'EMAIL')
      break
    case 'INTENT_NO_FIT':
      push('PRICING_VISIT', 2 + rng.int(0, 4))
      push('DEMO_REQUEST', 6 + rng.int(0, 6), 'FORM')
      push('PRODUCT_VISIT', 8 + rng.int(0, 6))
      push('PRICING_VISIT', 12 + rng.int(0, 8))
      push('WEBSITE_VISIT', 15 + rng.int(0, 8))
      push('FORM_SUBMIT', 20 + rng.int(0, 10), 'FORM')
      push('EMAIL_CLICK', 26 + rng.int(0, 10), 'EMAIL')
      push('WEBSITE_VISIT', 33 + rng.int(0, 12))
      break
    case 'STALE':
      push('WEBSITE_VISIT', 42 + rng.int(0, 10))
      push('PRODUCT_VISIT', 50 + rng.int(0, 12))
      push('EMAIL_OPEN', 62 + rng.int(0, 16), 'EMAIL')
      push('WEBSITE_VISIT', 78 + rng.int(0, 12))
      break
    case 'NEGATIVE':
      push('WEBSITE_VISIT', 10 + rng.int(0, 8))
      push('EMAIL_OPEN', 14 + rng.int(0, 6), 'EMAIL')
      push('NEGATIVE_FEEDBACK', 20 + rng.int(0, 10), 'EMAIL')
      push('UNSUBSCRIBE', 26 + rng.int(0, 12), 'EMAIL')
      break
    case 'MINIMAL':
      break
  }
  return ev
}

// ── Knowledge base content ───────────────────────────────────────────────────

const SALES_PLAYBOOK = `# LeadMind Sales Playbook

## Demo requests
Every demo request must be answered within 24 hours with a personalized scheduling link. Demo requests are our highest-converting signal: historically 34% of answered demo requests convert within one quarter, versus 6% when response takes longer than three days.

## Pricing conversations
When a prospect visits the pricing page three or more times in a month, treat this as an active evaluation. Offer a tailored pricing proposal aligned to their employee count and mention implementation services. Never send a bare pricing PDF: always attach a one-page ROI summary.

## Nurture cadence
Leads on the nurture track receive one insight email per week for six weeks. Content order: industry benchmark, customer story, product teardown, integration guide, security overview, executive summary. If a nurture lead clicks twice in one week, promote them to direct outreach.

## Re-engagement
For leads inactive for more than 14 days, send a light-touch message referencing the last content they engaged with. For leads inactive beyond 45 days, move to the quarterly insight newsletter and stop direct outreach.

## Qualification policy
Sales Ready requires fit >= 65, intent >= 60 and model probability >= 55%. Manual review is required when fit and intent disagree with the model prediction, or when data completeness is below 50%. Overrides must record a reason.

## Discount approvals
Discounts above 15% require director approval; above 25% require VP approval. Discounts are never applied before the first demo call.

## Data hygiene
Company records must include industry, employee count and revenue band before entering outreach. Emails on personal domains are flagged for review. Import files must be deduplicated against existing companies by domain.`

const PRODUCT_ICP_NOTES = `# Product & Ideal Customer Notes

## What LeadMind sells
LeadMind AI is a conversational sales intelligence platform. Customers connect their website analytics, email engagement and CRM events; the platform scores customer fit, buying intent and conversion probability, and provides a copilot that answers pipeline questions.

## Ideal customer profile
We sell best to B2B SaaS, FinTech, Healthcare IT, E-commerce and Logistics companies with 50-2000 employees, revenue between 1M and 100M, in the United States, Canada, United Kingdom, Germany, Australia and Singapore. Marketplace and enterprise business models are compatible. Small B2C agencies and sub-1M companies are a poor fit because the platform requires a functioning sales team.

## Pricing structure
Starter: $900/month for up to 3 seats and 500 scored leads. Growth: $2,400/month for 10 seats, 5000 scored leads and the copilot. Enterprise: from $6,000/month with SSO, custom ICP configuration and a dedicated success manager. Annual contracts receive a 12% discount.

## Common objections
"Is the scoring explainable?" Yes: every score lists positive and negative factors, and predictions include feature-level contributions. "Does it replace our CRM?" No: it reads and writes back to the CRM via connectors. "How long is implementation?" Typically 3 weeks including ICP calibration workshops.

## Security posture
SOC 2 Type II, encryption in transit and at rest, workspace-level data isolation, audit logging of all configuration changes, and regional data residency for EU customers.`

const POLICY_DOC = `# Business Policies

## Communication policy
Outbound email volume per lead is capped at 2 per week. Unsubscribed leads are excluded from all automated contact permanently. Negative feedback removes the lead from automated sequences for 30 days.

## Recommendation handling
Sales reps may accept, complete or dismiss recommendations; every status change is logged. Dismissing a CRITICAL recommendation requires a comment. The system avoids duplicating pending actions.

## Model governance
A new model version must beat the current production model on PR-AUC before activation. Test-set metrics are the only acceptable public performance claim. Training data provenance (synthetic vs real outcomes) must be disclosed on every model card.

## Memory and privacy
Conversation memories that contain business facts must be approved by a workspace admin before entering the assistant's context. Personal data about contacts is limited to professional information.`

// ── Seed implementation ──────────────────────────────────────────────────────

async function trainAndPersistModels(workspaceId: string): Promise<{ bestAlgorithm: string }> {
  // Build real outcome rows from leads that have verified outcomes (small sample)
  const outcomeLeads = await db.verifiedOutcome.findMany({ where: { workspaceId } })
  const realRows: { X: number[]; y: number; synthetic: boolean }[] = []
  const icp = DEFAULT_ICP
  for (const o of outcomeLeads) {
    const lead = await db.lead.findUnique({
      where: { id: o.leadId },
      include: { company: true, events: { select: { type: true, occurredAt: true, weight: true }, take: 200 } },
    })
    if (!lead) continue
    const fit = computeFit(
      lead.company ?? { industry: null, employeeCount: null, revenueBand: null, country: null, businessModel: null },
      lead,
      icp,
      'seed',
    )
    const intent = computeIntent(lead.events, DEFAULT_INTENT, 'seed')
    const fctx = buildFeatureVector({
      fitScore: fit.score,
      intentScore: intent.score,
      events30d: lead.events.filter((e) => Date.now() - e.occurredAt.getTime() <= 30 * DAY).length,
      pricingVisits30d: lead.events.filter((e) => e.type === 'PRICING_VISIT' && Date.now() - e.occurredAt.getTime() <= 30 * DAY).length,
      demoRequested: lead.events.some((e) => e.type === 'DEMO_REQUEST'),
      daysSinceLastEvent: lead.events[0] ? Math.round((Date.now() - lead.events[0].occurredAt.getTime()) / DAY) : null,
      engagementSpanDays: null,
      industryMatch: lead.company?.industry ? icp.targetIndustries.includes(lead.company.industry) : null,
      employeeCount: lead.company?.employeeCount ?? null,
      dealValue: lead.dealValue,
      dataCompleteness: 0.9,
    })
    realRows.push({ X: fctx.values, y: o.outcome === 'WON' ? 1 : 0, synthetic: false })
  }

  const { rows, summary } = buildDemoDataset(realRows, 560, 42)
  const { best, all } = trainAllModels(rows)
  const nowTag = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  for (const m of all) {
    const isBest = m === best
    const mv = await db.modelVersion.create({
      data: {
        workspaceId,
        name: 'leadmind-conversion',
        algorithm: m.algorithm,
        versionTag: `v1.${all.indexOf(m) + 1}.0-${nowTag}`,
        status: isBest ? 'PRODUCTION' : 'READY',
        params: JSON.stringify(m.params),
        features: JSON.stringify(summary.featureNames),
        artifacts: serializeModel(m),
        trainInfo: JSON.stringify(summary),
        evalMetrics: JSON.stringify({
          threshold: m.test.threshold,
          precision: m.test.precision,
          recall: m.test.recall,
          f1: m.test.f1,
          accuracy: m.test.accuracy,
          rocAuc: m.test.rocAuc,
          prAuc: m.test.prAuc,
          brier: m.test.brier,
        }),
        isProduction: isBest,
        trainedAt: new Date(),
      },
    })
    await db.modelEvaluation.create({
      data: {
        modelVersionId: mv.id,
        split: 'TEST',
        metrics: JSON.stringify({
          threshold: m.test.threshold,
          precision: m.test.precision,
          recall: m.test.recall,
          f1: m.test.f1,
          accuracy: m.test.accuracy,
          rocAuc: m.test.rocAuc,
          prAuc: m.test.prAuc,
          brier: m.test.brier,
        }),
        confusion: JSON.stringify(m.test.confusion),
        calibration: JSON.stringify(m.test.calibration),
      },
    })
    await db.modelEvaluation.create({
      data: {
        modelVersionId: mv.id,
        split: 'VALIDATION',
        metrics: JSON.stringify({
          threshold: m.val.threshold,
          precision: m.val.precision,
          recall: m.val.recall,
          f1: m.val.f1,
          accuracy: m.val.accuracy,
          rocAuc: m.val.rocAuc,
          prAuc: m.val.prAuc,
          brier: m.val.brier,
        }),
        confusion: JSON.stringify(m.val.confusion),
        calibration: JSON.stringify(m.val.calibration),
      },
    })
  }
  invalidateModelCache()
  return { bestAlgorithm: best.algorithm }
}

let seedPromise: Promise<void> | null = null

export function ensureSeed(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedInternal().catch((err) => {
      seedPromise = null
      throw err
    })
  }
  return seedPromise
}

async function seedInternal(): Promise<void> {
  const existing = await db.workspace.findUnique({ where: { slug: DEMO_WORKSPACE_SLUG } })
  if (existing) {
    // Guarantee a production model exists even if a previous seed was partial
    const modelCount = await db.modelVersion.count()
    if (modelCount === 0) {
      await trainAndPersistModels(existing.id)
      await computeDriftReport(existing.id)
      invalidateModelCache()
    }
    return
  }

  const workspace = await db.workspace.create({
    data: { name: 'LeadMind Demo Workspace', slug: DEMO_WORKSPACE_SLUG },
  })

  const user = await db.user.create({
    data: {
      email: DEMO_USER_EMAIL,
      name: 'Demo Analyst',
      passwordHash: hashPassword(DEMO_USER_PASSWORD),
    },
  })
  await db.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: 'ADMIN' },
  })

  await db.icpConfig.create({
    data: { workspaceId: workspace.id, version: 1, config: JSON.stringify(DEFAULT_ICP), isActive: true },
  })
  await db.intentConfig.create({
    data: { workspaceId: workspace.id, version: 1, config: JSON.stringify(DEFAULT_INTENT), isActive: true },
  })
  await db.setting.create({
    data: {
      workspaceId: workspace.id,
      key: 'qualification_thresholds',
      value: JSON.stringify(DEFAULT_QUALIFICATION),
    },
  })
  await db.setting.create({
    data: {
      workspaceId: workspace.id,
      key: 'product_info',
      value: JSON.stringify({
        summary:
          'LeadMind AI is a conversational sales intelligence platform scoring customer fit (ICP match), buying intent (behaviour) and conversion probability (ML). Pricing: Starter $900/mo (3 seats, 500 leads), Growth $2,400/mo (10 seats, 5000 leads, copilot), Enterprise from $6,000/mo.',
      }),
    },
  })

  const rng = makeRng(2024)
  const now = Date.now()
  const companyMap = new Map<string, string>()
  const leadMap = new Map<string, string>()

  for (const c of COMPANIES) {
    const row = await db.company.create({
      data: {
        workspaceId: workspace.id,
        name: c.name,
        industry: c.industry,
        employeeCount: c.employees,
        revenueBand: c.revenueBand,
        country: c.country,
        businessModel: c.businessModel,
        website: c.website,
      },
    })
    companyMap.set(c.name, row.id)
  }

  for (const l of LEADS) {
    const lead = await db.lead.create({
      data: {
        workspaceId: workspace.id,
        companyId: companyMap.get(l.company)!,
        contactName: l.contactName,
        email: l.email,
        title: l.title,
        phone: l.phone,
        status: 'ACTIVE',
        source: l.source,
        dealValue: l.dealValue,
      },
    })
    leadMap.set(l.company, lead.id)
    for (const e of eventsForArchetype(l.archetype, now, rng)) {
      await db.leadEvent.create({
        data: {
          leadId: lead.id,
          workspaceId: workspace.id,
          type: e.type,
          source: e.source,
          occurredAt: new Date(now - e.daysAgo * DAY - rng.int(0, 12) * 3600 * 1000),
          dedupeKey: `${e.type}:${e.daysAgo}`,
        },
      })
    }
  }

  // Knowledge base
  const docs: { name: string; kind: string; text: string }[] = [
    { name: 'Sales Playbook', kind: 'PLAYBOOK', text: SALES_PLAYBOOK },
    { name: 'Product & ICP Notes', kind: 'PRODUCT', text: PRODUCT_ICP_NOTES },
    { name: 'Business Policies', kind: 'POLICY', text: POLICY_DOC },
  ]
  for (const d of docs) {
    const doc = await db.knowledgeDocument.create({
      data: {
        workspaceId: workspace.id,
        name: d.name,
        kind: d.kind,
        mimeType: 'text/markdown',
        sizeBytes: d.text.length,
        status: 'READY',
        text: d.text,
      },
    })
    const chunks = chunkText(d.text)
    for (let i = 0; i < chunks.length; i++) {
      await db.documentChunk.create({
        data: { documentId: doc.id, workspaceId: workspace.id, ordinal: i, text: chunks[i] },
      })
    }
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { chunkCount: chunks.length } })
  }

  // Verified outcomes (real labels for the ML dataset; clearly a small sample)
  const outcomeSpecs: { company: string; outcome: 'WON' | 'LOST'; daysAgo: number; dealValue: number | null }[] = [
    { company: 'Nexora Cloud', outcome: 'WON', daysAgo: 30, dealValue: 92000 },
    { company: 'Freightwise', outcome: 'WON', daysAgo: 52, dealValue: 61000 },
    { company: 'Quantly', outcome: 'WON', daysAgo: 75, dealValue: 26000 },
    { company: 'Paycircuit', outcome: 'WON', daysAgo: 12, dealValue: 96000 },
    { company: 'Brightpath AI', outcome: 'LOST', daysAgo: 44, dealValue: 18000 },
    { company: 'Streamly Media', outcome: 'LOST', daysAgo: 39, dealValue: 12000 },
    { company: 'Corely Ops', outcome: 'LOST', daysAgo: 60, dealValue: 15000 },
    { company: 'Retailyantra', outcome: 'LOST', daysAgo: 82, dealValue: 44000 },
  ]
  for (const o of outcomeSpecs) {
    await db.verifiedOutcome.create({
      data: {
        leadId: leadMap.get(o.company)!,
        workspaceId: workspace.id,
        outcome: o.outcome,
        dealValue: o.dealValue,
        notes: o.outcome === 'WON' ? 'Closed successfully after demo sequence.' : 'Did not proceed after evaluation.',
        occurredAt: new Date(now - o.daysAgo * DAY),
        source: 'MANUAL',
      },
    })
    const leadId = leadMap.get(o.company)!
    await db.lead.update({
      where: { id: leadId },
      data: { status: o.outcome === 'WON' ? 'WON' : 'LOST' },
    })
  }

  // Feedback examples
  await db.feedback.createMany({
    data: [
      {
        workspaceId: workspace.id,
        leadId: leadMap.get('Nexora Cloud')!,
        kind: 'RECOMMENDATION_RATING',
        rating: 5,
        comment: 'Demo recommendation was exactly right — booked the same day.',
        payload: JSON.stringify({ action: 'SCHEDULE_DEMO', dismissed: false }),
      },
      {
        workspaceId: workspace.id,
        leadId: leadMap.get('Corely Ops')!,
        kind: 'RECOMMENDATION_RATING',
        rating: 2,
        comment: 'Nurture recommendation felt premature for this company size.',
        payload: JSON.stringify({ action: 'NURTURE', dismissed: true }),
      },
      {
        workspaceId: workspace.id,
        leadId: leadMap.get('Cartelio')!,
        kind: 'SCORE_DISAGREEMENT',
        rating: null,
        comment: 'Intent seems overstated; visits were likely from a student researching.',
        payload: null,
      },
    ],
  })

  // Memories
  await db.chatMemory.create({
    data: {
      workspaceId: workspace.id,
      scope: 'WORKSPACE',
      key: 'demo_scheduling_policy',
      value: 'The team prefers demo calls scheduled within 48 hours of a demo request, ideally Tuesday-Thursday mornings.',
      source: 'CONVERSATION',
      approved: true,
      confidence: 0.9,
      createdById: user.id,
    },
  })
  await db.chatMemory.create({
    data: {
      workspaceId: workspace.id,
      scope: 'LEAD',
      leadId: leadMap.get('Portline Logistics')!,
      key: 'context',
      value: 'Mei Ling mentioned Portline is evaluating vendors for an Asia-Pacific expansion; budget confirmed for Q3.',
      source: 'CONVERSATION',
      approved: false,
      confidence: 0.7,
      createdById: user.id,
    },
  })

  // Train models BEFORE running pipelines so predictions exist
  const { bestAlgorithm } = await trainAndPersistModels(workspace.id)

  // Run the analytical pipeline for every lead (persists assessments, qualifications, recommendations)
  for (const lead of await db.lead.findMany({ where: { workspaceId: workspace.id }, select: { id: true } })) {
    try {
      await runLeadPipeline(workspace.id, lead.id, { trigger: 'seed' })
    } catch (err) {
      console.error('[seed] pipeline failed for lead', lead.id, err)
    }
  }

  // Sample conversation grounded in real data
  const topLeads = await db.assessment.findMany({
    where: { workspaceId: workspace.id, kind: 'INTENT', score: { not: null } },
    orderBy: { score: 'desc' },
    take: 3,
    include: { lead: { include: { company: true } } },
  })
  const topNames = topLeads
    .map((a) => `${a.lead.contactName} (${a.lead.company?.name ?? 'unknown'}) — intent ${a.score}`)
    .join('; ')
  const conversation = await db.conversation.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      title: 'Weekly pipeline review',
      mode: 'DEMO',
    },
  })
  await db.message.createMany({
    data: [
      {
        conversationId: conversation.id,
        role: 'USER',
        content: 'Show me my best-performing leads this week.',
        createdAt: new Date(now - 2 * DAY),
      },
      {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content:
          `Based on current intent scores, your strongest leads are: ${topNames}. ` +
          `All three have recent demo or pricing activity. I recommend scheduling demos for the two highest-intent leads this week — the sales playbook requires responding to demo requests within 24 hours.`,
        createdAt: new Date(now - 2 * DAY + 30 * 1000),
        model: 'demo-assistant',
      },
    ],
  })

  // Drift report
  await computeDriftReport(workspace.id)

  await db.auditLog.createMany({
    data: [
      { workspaceId: workspace.id, userId: user.id, action: 'SEED_DEMO_ENVIRONMENT', detail: JSON.stringify({ companies: COMPANIES.length, leads: LEADS.length }) },
      { workspaceId: workspace.id, userId: user.id, action: 'MODEL_TRAINED', detail: JSON.stringify({ bestAlgorithm }) },
    ],
  })
}
