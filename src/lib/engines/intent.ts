import type { IntentConfigData, IntentEventInfo, IntentResult, ScoreFactor } from '@/lib/types'

export interface IntentEventInput {
  type: string
  occurredAt: Date
  weightOverride?: number | null
}

interface CountedEvent {
  type: string
  occurredAt: Date
  effective: number
}

const DAY_MS = 24 * 3600 * 1000

/**
 * Buying Intent engine — behavioural analysis of engagement events.
 * - Configurable weights (positive and negative)
 * - Exponential time decay with configurable half-life
 * - Frequency capping and deduplication for reproducibility
 * - Missing data is reported as unknown, never as negative interest
 */
export function computeIntent(
  events: IntentEventInput[],
  cfg: IntentConfigData,
  cfgVersion: string,
  now: Date = new Date(),
): IntentResult {
  const weights = cfg.weights as unknown as Record<string, number>
  const valid = events
    .filter((e) => typeof weights[e.type] === 'number' && e.occurredAt <= now)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  if (valid.length === 0) {
    return {
      score: null,
      hasData: false,
      factors: [
        {
          label: 'No engagement data',
          detail: 'No valid behavioural events recorded for this lead. Missing data is not interpreted as negative interest.',
          impact: 'NEUTRAL',
        },
      ],
      events: [],
      version: cfgVersion,
      explanation: 'Intent cannot be calculated because no engagement events exist yet.',
      lastEventAt: null,
    }
  }

  // Dedupe: same type within dedupeMinutes counts once. Frequency cap per type per day.
  const dedupeMs = Math.max(0, cfg.dedupeMinutes) * 60 * 1000
  const lastOfType = new Map<string, number>()
  const perTypePerDay = new Map<string, Map<string, number>>()
  const counted: CountedEvent[] = []
  const cappedOut = new Map<string, number>()

  for (const e of valid) {
    const t = e.occurredAt.getTime()
    const last = lastOfType.get(e.type)
    if (last !== undefined && t - last < dedupeMs) continue
    const dayKey = e.occurredAt.toISOString().slice(0, 10)
    let dayMap = perTypePerDay.get(e.type)
    if (!dayMap) {
      dayMap = new Map()
      perTypePerDay.set(e.type, dayMap)
    }
    const dayCount = dayMap.get(dayKey) ?? 0
    if (dayCount >= cfg.maxPerTypePerDay) {
      cappedOut.set(e.type, (cappedOut.get(e.type) ?? 0) + 1)
      continue
    }
    dayMap.set(dayKey, dayCount + 1)
    lastOfType.set(e.type, t)
    const base = e.weightOverride ?? weights[e.type]
    const ageDays = (now.getTime() - t) / DAY_MS
    const decay = Math.pow(0.5, ageDays / Math.max(cfg.halfLifeDays, 0.5))
    counted.push({ type: e.type, occurredAt: e.occurredAt, effective: base * decay })
  }

  const rawSum = counted.reduce((acc, e) => acc + e.effective, 0)
  const saturation = 100 * (1 - Math.exp(-Math.max(rawSum, 0) / Math.max(cfg.saturationK, 1)))
  const K = cfg.saturationK

  let score = saturation
  const factors: ScoreFactor[] = []

  const lastEvent = valid[valid.length - 1].occurredAt
  const daysSinceLast = (now.getTime() - lastEvent.getTime()) / DAY_MS

  if (daysSinceLast <= 7 && cfg.recencyBoost.within7d) {
    score += cfg.recencyBoost.within7d
    factors.push({
      label: 'Recent activity',
      detail: `Last event ${Math.max(1, Math.round(daysSinceLast))} day(s) ago: +${cfg.recencyBoost.within7d}`,
      impact: 'POSITIVE',
    })
  } else if (daysSinceLast <= 30 && cfg.recencyBoost.within30d) {
    score += cfg.recencyBoost.within30d
    factors.push({
      label: 'Recent activity',
      detail: `Last event ${Math.round(daysSinceLast)} days ago: +${cfg.recencyBoost.within30d}`,
      impact: 'POSITIVE',
    })
  }

  if (daysSinceLast > cfg.inactivityPenalty.afterDays) {
    score -= cfg.inactivityPenalty.amount
    factors.push({
      label: 'Inactivity',
      detail: `No events for ${Math.round(daysSinceLast)} days: -${cfg.inactivityPenalty.amount}`,
      impact: 'NEGATIVE',
    })
  }

  score = Math.min(100, Math.max(0, score))
  score = Math.round(score * 10) / 10

  // Aggregate per-type contributions for transparency
  const byType = new Map<string, { count: number; effective: number; lastAt: Date }>()
  for (const e of counted) {
    const cur = byType.get(e.type) ?? { count: 0, effective: 0, lastAt: e.occurredAt }
    cur.count += 1
    cur.effective += e.effective
    if (e.occurredAt > cur.lastAt) cur.lastAt = e.occurredAt
    byType.set(e.type, cur)
  }
  const eventsInfo: IntentEventInfo[] = [...byType.entries()]
    .map(([type, v]) => ({
      type,
      count: v.count,
      effectiveWeight: Math.round(v.effective * 10) / 10,
      lastAt: v.lastAt.toISOString(),
    }))
    .sort((a, b) => b.effectiveWeight - a.effectiveWeight)

  const top = eventsInfo.slice(0, 3)
  for (const t of top) {
    factors.push({
      label: `${t.type.replaceAll('_', ' ').toLowerCase()} (${t.count})`,
      detail: `Weighted contribution ${t.effectiveWeight} after time decay`,
      impact: t.effectiveWeight >= 0 ? 'POSITIVE' : 'NEGATIVE',
    })
  }
  if (cappedOut.size > 0) {
    factors.push({
      label: 'Frequency cap applied',
      detail: `${[...cappedOut.entries()].map(([t, c]) => `${t}:${c}`).join(', ')} excess events beyond ${cfg.maxPerTypePerDay}/day were excluded`,
      impact: 'NEUTRAL',
    })
  }

  const explanation =
    `Intent score ${score}/100 (config ${cfgVersion}) from ${counted.length} counted events ` +
    `(of ${valid.length} raw; dedupe window ${cfg.dedupeMinutes}m, cap ${cfg.maxPerTypePerDay}/day). ` +
    `Decay half-life ${cfg.halfLifeDays}d. ` +
    (daysSinceLast > cfg.inactivityPenalty.afterDays
      ? `Last engagement ${Math.round(daysSinceLast)} days ago.`
      : `Last engagement ${Math.max(1, Math.round(daysSinceLast))} day(s) ago.`)

  return {
    score,
    hasData: true,
    factors,
    events: eventsInfo,
    version: cfgVersion,
    explanation,
    lastEventAt: lastEvent.toISOString(),
  }
}
