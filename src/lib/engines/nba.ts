import type {
  PredictionResult,
  QualificationCategory,
  RecommendationAction,
  RecommendationDraft,
} from '@/lib/types'

export interface NbaEventSummary {
  type: string
  occurredAt: Date
}

export interface NbaInput {
  leadId: string
  leadName: string
  companyName: string
  fit: number | null
  intent: number | null
  prediction: PredictionResult | null
  qualification: QualificationCategory | null
  events: NbaEventSummary[] // sorted desc, last 180 days
  pendingActions: string[] // action names already PENDING
  missingFields: string[]
  pastOutcomes: { outcome: string; dealValue: number | null; occurredAt: Date }[]
  priorActionResults: Record<string, 'positive' | 'negative'> // learned from outcomes/feedback
}

const DAY = 24 * 3600 * 1000

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Next Best Action engine — deterministic, evidence-based recommendations.
 * Avoids duplicate pending actions and uses past outcomes as evidence.
 */
export function generateRecommendations(input: NbaInput): RecommendationDraft[] {
  const drafts: RecommendationDraft[] = []
  const now = new Date()
  const recent = (days: number) => input.events.filter((e) => now.getTime() - e.occurredAt.getTime() <= days * DAY)
  const lastEvent = input.events[0] ?? null
  const daysSinceLast = lastEvent
    ? Math.round((now.getTime() - lastEvent.occurredAt.getTime()) / DAY)
    : null

  const fit = input.fit ?? 0
  const intent = input.intent ?? 0
  const intentUnknown = input.intent === null

  const push = (d: RecommendationDraft) => {
    if (!input.pendingActions.includes(d.action)) drafts.push(d)
  }

  // 1. Unanswered demo request (most urgent buying signal)
  const demoReq = recent(14).find((e) => e.type === 'DEMO_REQUEST')
  const respondedAfterDemo =
    demoReq &&
    input.events.some(
      (e) => (e.type === 'CONTACTED' || e.type === 'MEETING') && e.occurredAt > demoReq.occurredAt,
    )
  if (demoReq && !respondedAfterDemo) {
    push({
      action: 'SCHEDULE_DEMO',
      priority: 'CRITICAL',
      explanation:
        `${input.leadName} at ${input.companyName} requested a demo on ${fmtDate(demoReq.occurredAt)} ` +
        `and no follow-up contact or meeting has been recorded since. Demo requests decay quickly — respond now.`,
      evidence: [`DEMO_REQUEST event on ${fmtDate(demoReq.occurredAt)}`, 'No CONTACTED/MEETING event after the request'],
      signals: ['demo_request_unanswered', 'high_buying_signal'],
      suggestedTiming: 'Within 24 hours',
    })
  }

  // 2. Repeated pricing evaluation
  const pricing30 = recent(30).filter((e) => e.type === 'PRICING_VISIT').length
  if (pricing30 >= 2 && fit >= 55) {
    push({
      action: 'CONTACT_NOW',
      priority: 'HIGH',
      explanation:
        `${pricing30} pricing-page visits in the last 30 days combined with good ICP fit (${fit.toFixed(0)}/100) ` +
        `suggest active evaluation. A direct conversation is likely to be well received.`,
      evidence: [`${pricing30} PRICING_VISIT events in last 30 days`, `Fit score ${fit.toFixed(0)}/100`],
      signals: ['pricing_evaluation', 'strong_fit'],
      suggestedTiming: 'This week',
    })
  }

  // 3. Sales-ready → demo
  if (input.qualification === 'SALES_READY' && fit >= 65 && (intent >= 70 || !intentUnknown)) {
    push({
      action: 'SCHEDULE_DEMO',
      priority: 'HIGH',
      explanation:
        `The lead is classified Sales Ready (fit ${fit.toFixed(0)}, intent ${input.intent === null ? 'unknown' : intent.toFixed(0)}` +
        `${input.prediction ? `, predicted conversion ${(input.prediction.probability * 100).toFixed(0)}%` : ''}). ` +
        `High-fit, high-intent leads convert best with a product demonstration.`,
      evidence: [
        `Qualification: SALES_READY`,
        input.prediction ? `Model probability ${(input.prediction.probability * 100).toFixed(0)}%` : 'No valid model prediction',
      ],
      signals: ['sales_ready', 'high_intent'],
      suggestedTiming: 'This week',
    })
  }

  // 4. Intent/fit mismatch — re-evaluate targeting
  if (!intentUnknown && intent >= 55 && fit < 40) {
    push({
      action: 'REASSESS_FIT',
      priority: 'MEDIUM',
      explanation:
        `Strong engagement (intent ${intent.toFixed(0)}) but poor ICP fit (${fit.toFixed(0)}). ` +
        `Either the ICP configuration is too strict, or the lead is researching without buying authority. Verify company attributes.`,
      evidence: [`Intent ${intent.toFixed(0)} vs fit ${fit.toFixed(0)}`],
      signals: ['fit_intent_mismatch'],
      suggestedTiming: 'Next 2 weeks',
    })
  }

  // 5. Good fit, low engagement → nurture
  if (!intentUnknown && fit >= 55 && intent < 45) {
    push({
      action: 'NURTURE',
      priority: 'MEDIUM',
      explanation:
        `Good ICP fit (${fit.toFixed(0)}) but limited engagement (intent ${intent.toFixed(0)}). ` +
        `A structured nurture sequence builds familiarity before a direct sales approach.`,
      evidence: [`Fit ${fit.toFixed(0)}`, `Intent ${intent.toFixed(0)}`],
      signals: ['low_engagement', 'strong_fit'],
      suggestedTiming: 'Next 2 weeks',
    })
  }

  // 6. Missing information
  if (input.missingFields.length > 0 && fit >= 40) {
    push({
      action: 'REQUEST_INFO',
      priority: 'MEDIUM',
      explanation:
        `Required profile information is missing (${input.missingFields.join(', ')}). ` +
        `Requesting these details improves scoring accuracy and creates a natural touchpoint.`,
      evidence: [`Missing: ${input.missingFields.join(', ')}`],
      signals: ['data_gap'],
      suggestedTiming: 'Next 2 weeks',
    })
  }

  // 7. Re-engagement of warm leads going cold
  if (daysSinceLast !== null && daysSinceLast >= 14 && daysSinceLast <= 45 && (input.intent ?? 0) >= 40) {
    push({
      action: 'RE_ENGAGE',
      priority: 'MEDIUM',
      explanation:
        `No activity for ${daysSinceLast} days, but historical intent was ${intent.toFixed(0)}/100. ` +
        `A light-touch re-engagement message can revive the conversation before interest fully decays.`,
      evidence: [`Last event ${fmtDate(lastEvent!.occurredAt)} (${daysSinceLast}d ago)`],
      signals: ['cooling_engagement'],
      suggestedTiming: 'This week',
    })
  }

  // 8. Cold lead
  if (daysSinceLast !== null && daysSinceLast > 45) {
    push({
      action: 'RE_ENGAGE',
      priority: 'LOW',
      explanation:
        `No activity for ${daysSinceLast} days. The lead has gone cold; add to a long-term newsletter/insight cadence rather than direct outreach.`,
      evidence: [`Last event ${fmtDate(lastEvent!.occurredAt)} (${daysSinceLast}d ago)`],
      signals: ['cold_lead'],
      suggestedTiming: 'Opportunistic',
    })
  }

  // 9. Baseline monitoring
  if (drafts.length === 0) {
    push({
      action: 'MONITOR',
      priority: 'LOW',
      explanation:
        input.intent === null
          ? `No engagement data yet. Monitor for the first behavioural signals before acting.`
          : `Current profile is balanced (fit ${fit.toFixed(0)}, intent ${intent.toFixed(0)}). Monitor for changes rather than interrupting.`,
      evidence: [input.intent === null ? 'No events recorded' : 'No actionable threshold crossed'],
      signals: [],
      suggestedTiming: 'Opportunistic',
    })
  }

  // Apply learned priors from previous outcomes
  for (const d of drafts) {
    const prior = input.priorActionResults[d.action]
    if (prior === 'negative') {
      d.evidence.push('Previous outcomes associated with this action were negative — treat with caution.')
    } else if (prior === 'positive') {
      d.evidence.push('This action type previously led to a positive outcome in this workspace.')
    }
    const lost = input.pastOutcomes.find((o) => o.outcome === 'LOST')
    if (lost) {
      d.evidence.push(`Note: a prior engagement with this lead was recorded as LOST on ${fmtDate(lost.occurredAt)}.`)
      break
    }
    const won = input.pastOutcomes.find((o) => o.outcome === 'WON')
    if (won) {
      d.evidence.push(`Note: this lead previously produced a WON outcome on ${fmtDate(won.occurredAt)}.`)
      break
    }
  }

  return drafts.slice(0, 4)
}

/** Learns per-action priors from verified outcomes and recommendation effectiveness. */
export function learnPriors(
  outcomes: { outcome: string; occurredAt: Date }[],
  feedbackByAction: Record<string, { accepted: number; dismissed: number }>,
): Record<string, 'positive' | 'negative'> {
  const priors: Record<string, 'positive' | 'negative'> = {}
  for (const [action, fb] of Object.entries(feedbackByAction)) {
    const total = fb.accepted + fb.dismissed
    if (total >= 2 && fb.dismissed > fb.accepted) priors[action] = 'negative'
    if (total >= 2 && fb.accepted > fb.dismissed * 2) priors[action] = 'positive'
  }
  if (outcomes.some((o) => o.outcome === 'WON')) {
    // A won outcome validates the proactive action set
    if (!priors['SCHEDULE_DEMO']) priors['SCHEDULE_DEMO'] = 'positive'
  }
  return priors
}

export const ACTION_LABELS: Record<RecommendationAction, string> = {
  CONTACT_NOW: 'Contact the prospect',
  SCHEDULE_DEMO: 'Schedule a product demo',
  SEND_CONTENT: 'Send relevant content',
  NURTURE: 'Continue nurturing',
  REQUEST_INFO: 'Request missing information',
  REASSESS_FIT: 'Reassess compatibility',
  MONITOR: 'Monitor engagement',
  RE_ENGAGE: 'Re-engage the lead',
}
