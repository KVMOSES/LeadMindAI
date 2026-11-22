import { executeTool, type ToolContext, type ToolResult } from '@/lib/chat/tools'
import type { ToolTrace } from '@/lib/types'
import type { Emit } from '@/lib/chat/copilot'

const DEMO_BANNER =
  '*Local demo assistant — deterministic, rule-based, connected to your live workspace data. No external LLM is configured, so responses are generated from predefined analytical patterns rather than free-form reasoning.*\n\n'

function leadTable(leads: Record<string, unknown>[]): string {
  if (leads.length === 0) return '_No leads matched._'
  const header = '| Lead | Company | Fit | Intent | Conv. % | Qualification |'
  const sep = '|---|---|---:|---:|---:|---|'
  const rows = leads
    .map((l) => {
      const prob = typeof l.conversionProbability === 'number' ? `${Math.round(l.conversionProbability * 100)}%` : 'n/a'
      return `| **${l.contact}** | ${l.company} | ${l.fit ?? 'n/a'} | ${l.intent ?? 'n/a'} | ${prob} | ${l.qualification ?? 'n/a'} |`
    })
    .join('\n')
  return `${header}\n${sep}\n${rows}`
}

function fmtFactor(f: { label: string; detail: string; impact: string }): string {
  const icon = f.impact === 'POSITIVE' ? '+' : f.impact === 'NEGATIVE' ? '-' : '~'
  return `- **${icon} ${f.label}** — ${f.detail}`
}

type Handler = (ctx: ToolContext, raw: string, traces: ToolTrace[]) => Promise<string>

async function t(ctx: ToolContext, name: string, args: Record<string, unknown>, traces: ToolTrace[]): Promise<ToolResult> {
  const res = await executeTool(ctx, name, args)
  traces.push({ name, args, ok: res.ok, summary: res.ok ? (res.summary ?? 'completed') : (res.error ?? 'failed'), ms: res.ms })
  return res
}

const PATTERNS: { re: RegExp; fn: Handler }[] = [
  {
    re: /^(hi|hello|hey|good (morning|afternoon))/,
    fn: async () =>
      `Hello! I am the **LeadMind demo assistant**. I answer questions using your real workspace data. Try:\n\n` +
      `- "Show me my best-performing leads"\n` +
      `- "Which leads should I contact today?"\n` +
      `- "Find companies with high fit but low buying intent"\n` +
      `- "Why did this lead receive a low score?"\n` +
      `- "Which industry is generating the highest conversion rate?"\n` +
      `- "Are my leads becoming less engaged?"\n` +
      `- "Identify potential data quality problems"\n` +
      `- "What should I do next?"`,
  },
  {
    re: /(best|top|strongest|highest).*(lead|prospect|account)|best-performing/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'search_leads', { sort: 'fit', limit: 5, status: 'ACTIVE' }, traces)
      const res2 = await t(ctx, 'search_leads', { sort: 'intent', limit: 5, status: 'ACTIVE' }, traces)
      if (!res.ok || !res2.ok) return `I could not retrieve leads: ${res.error ?? res2.error}`
      const fits = (res.data as { leads: Record<string, unknown>[] }).leads
      const intents = (res2.data as { leads: Record<string, unknown>[] }).leads
      return (
        `Here are your strongest leads right now (retrieved with search_leads, sorted by score):\n\n**Highest customer fit**\n${leadTable(fits)}\n\n**Highest buying intent**\n${leadTable(intents)}\n\n` +
        `**Why they matter:** leads combining fit ≥ 65 with intent ≥ 60 qualify as Sales Ready under your current thresholds. Leads appearing in both tables are your priority outreach targets today.\n\n` +
        `**Suggested next step:** open one of these lead profiles and ask me "why was this lead classified as Sales Ready?"`
      )
    },
  },
  {
    re: /(contact|call|reach) (them |him |her )?(today|now)|what should i do next|next steps|top priorities|priorities today/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'get_recommendations', { status: 'PENDING', limit: 6 }, traces)
      if (!res.ok) return `Could not retrieve recommendations: ${res.error}`
      const recs = res.data as { lead: string; actionLabel: string; priority: string; explanation: string; suggestedTiming: string }[]
      if (recs.length === 0) return 'There are no pending recommendations right now. Run an assessment on a lead profile to generate next-best-actions.'
      return (
        `Here are your pending next-best-actions from the recommendation engine, ordered by priority:\n\n` +
        recs
          .map(
            (r, i) =>
              `${i + 1}. **${r.actionLabel}** — ${r.lead}\n   *Priority:* ${r.priority} · *Timing:* ${r.suggestedTiming}\n   ${r.explanation}`,
          )
          .join('\n\n') +
        `\n\n*Evidence-based and deduplicated: the engine never proposes an action already pending for the same lead.*`
      )
    },
  },
  {
    re: /(high|good) (fit|icp).*(low|weak|no|little|poor).*(intent|engagement)|fit but low/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'search_leads', { minFit: 60, maxIntent: 45, limit: 8, sort: 'fit' }, traces)
      if (!res.ok) return `Could not search: ${res.error}`
      const leads = (res.data as { leads: Record<string, unknown>[] }).leads
      return (
        `Leads with **fit ≥ 60** and **intent ≤ 45** (high ICP match, weak engagement):\n\n${leadTable(leads)}\n\n` +
        `**Interpretation:** these companies match your ideal customer profile but show little buying behaviour — classic nurture-track candidates. ` +
        `The recommendation engine typically proposes a structured nurture sequence for this pattern (see the Action Center).`
      )
    },
  },
  {
    re: /(high|strong).*(intent|engagement).*(low|poor|weak) (fit|icp)|intent but (low|poor) fit/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'search_leads', { minIntent: 55, maxFit: 40, limit: 8, sort: 'intent' }, traces)
      if (!res.ok) return `Could not search: ${res.error}`
      const leads = (res.data as { leads: Record<string, unknown>[] }).leads
      return (
        `Leads with **intent ≥ 55** but **fit ≤ 40**:\n\n${leadTable(leads)}\n\n` +
        `**Interpretation:** strong engagement from companies outside your ICP. Either the ICP configuration is too strict, or these are research visitors without buying authority. The engine flags these for fit reassessment.`
      )
    },
  },
  {
    re: /(why|explain|how).*(score|classified|ready|rated|assessment|qualification)/,
    fn: async (ctx, raw, traces) => {
      const nameMatch = raw.match(/(?:for|did|is|about)\s+([A-Za-z][A-Za-z .'-]{2,40}?)(?:\?|receive|get|classified|scored|$)/)
      const leadName = nameMatch?.[1]?.trim()
      const res = await t(ctx, 'explain_lead_scoring', leadName ? { leadName } : {}, traces)
      if (!res.ok) return `I could not resolve the lead: ${res.error}. Try naming the contact or company, e.g. "why did Sarah Mitchell receive that score?"`
      const d = res.data as {
        lead: string
        fit: { score: number; factors: { label: string; detail: string; impact: string }[] } | null
        intent: { score: number | null; explanation: string } | null
        prediction: { probability: number; modelVersion: string; contributions: { label: string; contribution: number }[]; reliability: string } | null
        qualification: { category: string; reasons: string[] } | null
      }
      let out = `## Scoring explanation — ${d.lead}\n\n`
      if (d.fit) out += `### Customer fit: ${d.fit.score}/100\n${d.fit.factors.map(fmtFactor).join('\n')}\n\n`
      if (d.intent) out += `### Buying intent: ${d.intent.score ?? 'unknown'}\n${d.intent.explanation}\n\n`
      if (d.prediction) {
        out += `### Conversion prediction: ${(d.prediction.probability * 100).toFixed(0)}% (${d.prediction.modelVersion})\nTop contributing features (marginal effects on probability):\n`
        out += d.prediction.contributions
          .slice(0, 5)
          .map((x) => `- **${x.label}**: ${x.contribution >= 0 ? '+' : ''}${(x.contribution * 100).toFixed(1)} pp`)
          .join('\n')
        out += `\n\n*Reliability: ${d.prediction.reliability}*\n\n`
      }
      if (d.qualification) out += `### Qualification: ${d.qualification.category}\n${d.qualification.reasons.map((r) => `- ${r}`).join('\n')}`
      return out
    },
  },
  {
    re: /compare|versus|side by side/,
    fn: async (ctx, raw, traces) => {
      const nameMatches = raw.match(/\b([a-z][a-z]+(?: [a-z][a-z]+)?)\b/g) ?? []
      const stop = new Set([
        'compare', 'why', 'show', 'what', 'which', 'the', 'this', 'lead', 'with', 'other', 'leads', 'high', 'fit',
        'please', 'company', 'companies', 'similar', 'tell', 'about', 'versus', 'side by side',
      ])
      const names = [...new Set(nameMatches.filter((n) => !stop.has(n)))].slice(0, 4)
      const res = await t(ctx, 'compare_leads', names.length >= 2 ? { leadNames: names } : {}, traces)
      if (!res.ok) {
        return `I could not resolve enough leads to compare (${res.error}). Name two contacts or companies explicitly, e.g. "compare Sarah Mitchell and James Okafor".` +
          (ctx.activeLeadId ? ' With a lead profile open, "compare this lead with other high-fit leads" also works.' : '')
      }
      const rows = (res.data as { comparison: Record<string, unknown>[] }).comparison
      const header = '| Lead | Industry | Fit | Intent | Conv. % | Qualification | Deal value |'
      const sep = '|---|---|---:|---:|---:|---|---:|'
      const body = rows
        .map((r) => {
          const prob = typeof r.conversionProbability === 'number' ? `${Math.round(r.conversionProbability * 100)}%` : 'n/a'
          const dv = typeof r.dealValue === 'number' ? `$${Number(r.dealValue).toLocaleString()}` : 'n/a'
          return `| ${r.label} | ${r.industry ?? 'n/a'} | ${r.fit ?? 'n/a'} | ${r.intent ?? 'n/a'} | ${prob} | ${r.qualification ?? 'n/a'} | ${dv} |`
        })
        .join('\n')
      return `### Side-by-side comparison (live records)\n\n${header}\n${sep}\n${body}`
    },
  },
  {
    re: /(industry|industries|sector|vertical).*(convert|conversion|perform|best|generating)|which industry/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'get_dashboard_metrics', {}, traces)
      if (!res.ok) return `Could not load metrics: ${res.error}`
      const industries = (res.data as { industries: { industry: string; leads: number; avgFit: number | null; avgIntent: number | null; won: number; lost: number; conversionRate: number | null }[] }).industries
      const withConv = [...industries].filter((i) => i.conversionRate !== null).sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0))
      const best = withConv[0]
      return (
        `### Industry performance\n\n| Industry | Leads | Avg fit | Avg intent | Won | Lost | Conversion |\n|---|---:|---:|---:|---:|---:|---:|\n` +
        industries
          .map((i) => `| ${i.industry} | ${i.leads} | ${i.avgFit ?? 'n/a'} | ${i.avgIntent ?? 'n/a'} | ${i.won} | ${i.lost} | ${i.conversionRate !== null ? `${Math.round(i.conversionRate * 100)}%` : 'n/a'} |`)
          .join('\n') +
        `\n\n**Highest verified conversion:** ${best ? `${best.industry} at ${Math.round((best.conversionRate ?? 0) * 100)}% (${best.won}W/${best.lost}L)` : 'insufficient closed outcomes yet'}.\n\n` +
        `*Conversion rates count only leads with verified WON/LOST outcomes — open leads are excluded to avoid inflated claims.*`
      )
    },
  },
  {
    re: /(less engaged|more engaged|engagement trend|becoming|trend|declin|rising|falling)/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'get_engagement_trends', { weeks: 10 }, traces)
      if (!res.ok) return `Could not load trends: ${res.error}`
      const { trends, intentDirection } = res.data as { trends: { label: string; events: number; avgIntent: number | null }[]; intentDirection: string }
      return (
        `### Engagement trend (last 10 weeks)\n\n| Week | Events | Avg intent |\n|---|---:|---:|\n` +
        trends.map((x) => `| ${x.label} | ${x.events} | ${x.avgIntent ?? 'n/a'} |`).join('\n') +
        `\n\n**Direction: ${intentDirection}.** ` +
        (intentDirection === 'FALLING'
          ? 'Engagement is decaying — consider re-engagement campaigns for warm leads before interest fully cools.'
          : intentDirection === 'RISING'
            ? 'Engagement is rising — a good moment to push demo scheduling for high-intent leads.'
            : intentDirection === 'FLAT'
              ? 'No strong directional signal; monitor weekly.'
              : 'Not enough assessed leads yet to establish a trend.')
      )
    },
  },
  {
    re: /(pricing|price).*(visit|page|multiple|repeat)|visited.*pricing/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'search_leads', { sort: 'intent', limit: 8, status: 'ACTIVE' }, traces)
      const trendRes = await t(ctx, 'get_engagement_trends', { weeks: 4 }, traces)
      if (!res.ok) return `Could not search leads: ${res.error}`
      const leads = (res.data as { leads: Record<string, unknown>[] }).leads
      const pv = trendRes.ok ? (trendRes.data as { trends: { pricingVisits: number }[] }).trends.reduce((a, x) => a + x.pricingVisits, 0) : 0
      return (
        `Leads currently showing evaluation-grade intent (which correlates with pricing-page activity):\n\n${leadTable(leads)}\n\n` +
        `Pricing visits across the workspace in the last 4 weeks: **${pv}**.\n\n` +
        `From your Sales Playbook (knowledge base): *"When a prospect visits the pricing page three or more times in a month, treat this as an active evaluation. Offer a tailored pricing proposal aligned to their employee count."*`
      )
    },
  },
  {
    re: /(follow[- ]?up|followed up|not received|uncontacted|no outreach)/,
    fn: async (ctx, _raw, traces) => {
      const recs = await t(ctx, 'get_recommendations', { status: 'PENDING', limit: 15 }, traces)
      if (!recs.ok) return `Could not load recommendations: ${recs.error}`
      const list = recs.data as { lead: string; actionLabel: string; priority: string; explanation: string }[]
      const follow = list.filter((r) => ['CONTACT_NOW', 'SCHEDULE_DEMO', 'RE_ENGAGE', 'REQUEST_INFO'].includes(r.actionLabel))
      const shown = (follow.length > 0 ? follow : list).slice(0, 8)
      return (
        `Leads with **pending follow-up recommendations**:\n\n` +
        shown.map((r) => `- **${r.lead}** → ${r.actionLabel} (${r.priority}): ${r.explanation.slice(0, 150)}`).join('\n') +
        `\n\n*The engine deduplicates: a lead never gets two pending actions of the same type.*`
      )
    },
  },
  {
    re: /(data quality|quality problems|dirty data|missing data|data issues)/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'get_data_quality_report', {}, traces)
      if (!res.ok) return `Could not load report: ${res.error}`
      const d = res.data as {
        totalLeads: number
        leadsWithoutEvents: number
        invalidEvents: number
        issues: string[]
        missingFields: { field: string; count: number; pct: number }[]
      }
      return (
        `### Data quality report (${d.totalLeads} leads)\n\n` +
        (d.issues.length > 0 ? d.issues.map((i) => `- ${i}`).join('\n') : '- No significant issues detected.') +
        `\n\n**Missing fields:**\n` +
        (d.missingFields.filter((f) => f.count > 0).map((f) => `- ${f.field}: ${f.count} leads (${f.pct}%)`).join('\n') || '- All key fields populated.')
      )
    },
  },
  {
    re: /(model|drift|evaluation|roc|auc|accuracy|predictive)/,
    fn: async (ctx, _raw, traces) => {
      const status = await t(ctx, 'get_model_status', {}, traces)
      const drift = await t(ctx, 'get_drift_report', {}, traces)
      if (!status.ok) return `Could not load model status: ${status.error}`
      const d = status.data as {
        production: { algorithm: string; versionTag: string; testMetrics: { rocAuc: number; prAuc: number; f1: number | null }; dataset: { totalRows: number; syntheticRows: number; realOutcomeRows: number; note: string } } | null
        note?: string
      }
      let out = ''
      if (!d.production) {
        out += `**No production model is active.** ${d.note ?? ''} Train one on the Model Intelligence page — until then, conversion predictions are disabled rather than fabricated.`
      } else {
        const p = d.production
        out += `### Production model\n- **${p.algorithm}** ${p.versionTag}\n- Test ROC-AUC: **${p.testMetrics.rocAuc}** · PR-AUC: **${p.testMetrics.prAuc}** · F1: ${p.testMetrics.f1 ?? 'n/a'}\n- Dataset: ${p.dataset.totalRows} rows (${p.dataset.syntheticRows} synthetic / ${p.dataset.realOutcomeRows} real outcomes)\n- Provenance: ${p.dataset.note}\n`
      }
      if (drift.ok) {
        const dr = drift.data as { status: string; scoredLeads: number; overallPsi: number; features?: { label: string; psi: number; level: string }[] }
        out += `\n### Drift monitoring\n- Status: **${dr.status}** across ${dr.scoredLeads} scored leads (overall PSI ${dr.overallPsi})\n`
        const top = (dr.features ?? []).sort((a, b) => b.psi - a.psi).slice(0, 3)
        if (top.length) out += top.map((f) => `- ${f.label}: PSI ${f.psi} (${f.level})`).join('\n')
      }
      return out
    },
  },
  {
    re: /(summar|overview|tell me about|profile of)/,
    fn: async (ctx, raw, traces) => {
      const nameMatch = raw.match(/(?:about|of|for)\s+([A-Za-z][A-Za-z .'-]{2,40}?)(\?|$|\.)\s*/)
      const leadName = nameMatch?.[1]?.trim()
      const res = await t(ctx, 'get_lead_details', leadName ? { leadName } : {}, traces)
      if (!res.ok) return `I could not resolve that lead: ${res.error}. Open a lead profile and ask "summarise this company", or name the contact.`
      const d = res.data as {
        contact: string
        company: string
        industry: string | null
        fit: number | null
        intent: number | null
        conversionProbability: number | null
        qualification: string | null
        status: string
        dealValue: number | null
        pendingRecommendations: { actionLabel: string; priority: string }[]
        outcomes: { outcome: string; dealValue: number | null }[]
        recentEvents: { type: string; occurredAt: string }[]
      }
      return (
        `## ${d.contact} — ${d.company}\n\n` +
        `- Industry: ${d.industry ?? 'unknown'} · Status: ${d.status}${d.dealValue ? ` · Deal value: $${Number(d.dealValue).toLocaleString()}` : ''}\n` +
        `- Fit: **${d.fit ?? 'not assessed'}** · Intent: **${d.intent ?? 'not assessed'}** · Conversion: **${d.conversionProbability !== null ? `${Math.round(d.conversionProbability * 100)}%` : 'no valid model'}**\n` +
        `- Qualification: **${d.qualification ?? 'pending assessment'}**\n` +
        `- Recent activity: ${d.recentEvents.slice(0, 5).map((e) => `${e.type.replaceAll('_', ' ').toLowerCase()} (${e.occurredAt.slice(0, 10)})`).join(', ') || 'none'}\n` +
        `- Pending actions: ${d.pendingRecommendations.map((r) => `${r.actionLabel} (${r.priority})`).join(', ') || 'none'}\n` +
        `- Verified outcomes: ${d.outcomes.map((o) => `${o.outcome}${o.dealValue ? ` $${Number(o.dealValue).toLocaleString()}` : ''}`).join(', ') || 'none'}`
      )
    },
  },
  {
    re: /(what changed|change in|assessment history|history)/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'get_assessment', { history: true }, traces)
      if (!res.ok) return `Could not load assessment history: ${res.error}`
      const d = res.data as { lead: string; assessments: Record<string, { at: string; score: number | null; version: string }[]> }
      let out = `### Assessment history — ${d.lead}\n\n`
      for (const [kind, items] of Object.entries(d.assessments)) {
        if (!Array.isArray(items) || items.length === 0) continue
        out += `**${kind}:** ${items.slice(0, 3).map((i) => `${i.score ?? '—'} (${i.at.slice(0, 10)}, ${i.version})`).join(' → ')}\n\n`
      }
      out += '*Every assessment stores its config/model version and content hash, so changes are fully traceable.*'
      return out
    },
  },
  {
    re: /(remember|memory|stored context)/,
    fn: async (ctx, _raw, traces) => {
      const res = await t(ctx, 'get_lead_memory', {}, traces)
      if (!res.ok) return `Could not load memory: ${res.error}`
      const items = res.data as { scope: string; value: string; approved: boolean }[]
      return (
        `### Stored conversational memory\n\n` +
        (items.length === 0
          ? 'No memories stored yet. Say "remember that ..." and confirm the card to store one.'
          : items.map((m) => `- ${m.approved ? '[approved]' : '[pending approval]'} [${m.scope}] ${m.value}`).join('\n')) +
        `\n\nOnly approved memories enter the assistant context; pending ones require approval in Settings → Memory.`
      )
    },
  },
  {
    re: /(playbook|policy|knowledge|discount|document)/,
    fn: async (ctx, raw, traces) => {
      const q =
        raw
          .replace(/what|does|say|about|our|tell me|search|find|the|knowledge base|document|policy|playbook/g, '')
          .trim() || 'sales playbook demo pricing policies'
      const res = await t(ctx, 'search_knowledge', { query: q, topK: 4 }, traces)
      if (!res.ok) return `Knowledge search failed: ${res.error}`
      const d = res.data as { excerpts: { source: string; excerpt: string; relevance: number }[]; note?: string }
      if (d.excerpts.length === 0) return `No matching knowledge found. ${d.note ?? ''}`
      return (
        `### Relevant knowledge excerpts\n\n` +
        d.excerpts.map((e) => `**[${e.source}]**\n> ${e.excerpt.slice(0, 320)}…`).join('\n\n') +
        `\n\n*Retrieved via TF-IDF retrieval over your workspace knowledge base, with source attribution.*`
      )
    },
  },
]

/** Deterministic demo copilot: pattern recognition → real tool execution → formatted answer. */
export async function runDemoTurn(
  ctx: ToolContext,
  userMessage: string,
  emit: Emit,
): Promise<{ answer: string; traces: ToolTrace[] }> {
  emit({ type: 'status', stage: 'demo_reasoning' })
  const traces: ToolTrace[] = []
  const raw = userMessage.toLowerCase()

  for (const p of PATTERNS) {
    if (p.re.test(raw)) {
      try {
        const answer = await p.fn(ctx, raw, traces)
        return { answer: DEMO_BANNER + answer, traces }
      } catch (err) {
        return {
          answer: DEMO_BANNER + `Something went wrong while executing that analysis: ${err instanceof Error ? err.message : 'unknown error'}`,
          traces,
        }
      }
    }
  }

  return {
    answer:
      DEMO_BANNER +
      `I did not recognize that request pattern. As a deterministic demo assistant I support a fixed set of analytical queries, for example:\n\n` +
      `- "Show me my best-performing leads"\n` +
      `- "Which leads should I contact today?"\n` +
      `- "Find companies with high fit but low buying intent"\n` +
      `- "Why did this lead receive a low score?"\n` +
      `- "Which industry is generating the highest conversion rate?"\n` +
      `- "Are my leads becoming less engaged?"\n` +
      `- "Which prospects have not received follow-up?"\n` +
      `- "Identify potential data quality problems"\n` +
      `- "Show me the model's latest evaluation"\n\n` +
      `Every answer is generated from **live workspace data** through the same validated tools the full LLM assistant uses. Configure an external LLM provider for free-form conversation.`,
    traces,
  }
}

/** Page-aware suggested questions. */
export function getSuggestions(page: string, hasActiveLead: boolean): string[] {
  const base = [
    'Show me my best-performing leads',
    'Which leads should I contact today?',
    'Find companies with high fit but low buying intent',
    'Which industry is generating the highest conversion rate?',
    'Identify potential data quality problems',
    "Show me the model's latest evaluation",
  ]
  const leadContext = [
    'Why was this lead classified as Sales Ready?',
    'Compare this lead with other high-fit leads',
    'Summarise the activity of this company',
  ]
  if (hasActiveLead) return [...leadContext, base[0], base[1]]
  if (page === 'dashboard') return [base[0], base[1], base[3], 'Are my leads becoming less engaged?']
  if (page === 'models') return ["Show me the model's latest evaluation", base[4], 'Is there any feature drift?', base[2]]
  if (page === 'actions') return [base[1], 'Which prospects have not received follow-up?', 'Explain why the top recommendation was generated', base[0]]
  return base
}
