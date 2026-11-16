import { db } from '@/lib/db'
import { executeTool, type ToolContext } from '@/lib/chat/tools'
import { audit } from '@/lib/audit'
import { runLeadPipeline } from '@/lib/engines/pipeline'

/**
 * Executes a confirmed pending action. This is the ONLY path by which
 * confirm-required chatbot write tools touch business data.
 */
export async function executePendingAction(
  pendingActionId: string,
  ctx: ToolContext,
): Promise<{ ok: boolean; summary: string; data?: unknown }> {
  const pa = await db.pendingAction.findFirst({
    where: { id: pendingActionId, workspaceId: ctx.workspaceId, status: 'PENDING' },
  })
  if (!pa) {
    return { ok: false, summary: 'Pending action not found or already handled.' }
  }

  let result: { ok: boolean; summary: string; data?: unknown }

  if (pa.toolName === 'create_lead') {
    const args = JSON.parse(pa.args) as {
      companyName: string
      contactName: string
      industry?: string
      employeeCount?: number
      revenueBand?: string
      country?: string
      businessModel?: string
      email?: string
      title?: string
      dealValue?: number
      source?: string
    }
    let companyId: string | null = null
    const existing = await db.company.findFirst({
      where: { workspaceId: ctx.workspaceId, name: args.companyName },
    })
    if (existing) {
      companyId = existing.id
    } else {
      const company = await db.company.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: args.companyName,
          industry: args.industry ?? null,
          employeeCount: args.employeeCount ?? null,
          revenueBand: args.revenueBand ?? null,
          country: args.country ?? null,
          businessModel: args.businessModel ?? null,
        },
      })
      companyId = company.id
    }
    const lead = await db.lead.create({
      data: {
        workspaceId: ctx.workspaceId,
        companyId,
        contactName: args.contactName,
        email: args.email ?? null,
        title: args.title ?? null,
        status: 'NEW',
        source: args.source ?? 'MANUAL',
        dealValue: args.dealValue ?? null,
      },
    })
    try {
      await runLeadPipeline(ctx.workspaceId, lead.id, { trigger: 'copilot_create' })
    } catch {
      // assessment failures must not fail creation
    }
    await audit(ctx.workspaceId, ctx.userId, 'LEAD_CREATED_VIA_COPILOT', { leadId: lead.id, companyName: args.companyName })
    result = { ok: true, summary: `Lead "${args.contactName}" created at "${args.companyName}". An initial assessment has been scheduled.`, data: { leadId: lead.id } }
  } else if (pa.toolName === 'update_lead') {
    const args = JSON.parse(pa.args) as { leadId: string; patch: Record<string, string | number> }
    const lead = await db.lead.findFirst({ where: { id: args.leadId, workspaceId: ctx.workspaceId }, include: { company: true } })
    if (!lead) {
      result = { ok: false, summary: 'Lead no longer exists.' }
    } else {
      const leadPatch: Record<string, string | number> = {}
      const companyPatch: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(args.patch)) {
        if (['industry', 'employeeCount', 'revenueBand', 'country', 'businessModel'].includes(k)) companyPatch[k] = v
        else leadPatch[k] = v
      }
      if (Object.keys(leadPatch).length > 0) {
        await db.lead.update({ where: { id: lead.id }, data: leadPatch })
      }
      if (Object.keys(companyPatch).length > 0 && lead.companyId) {
        await db.company.update({ where: { id: lead.companyId }, data: companyPatch })
      }
      try {
        await runLeadPipeline(ctx.workspaceId, lead.id, { trigger: 'copilot_update', force: true })
      } catch {
        // ignore
      }
      await audit(ctx.workspaceId, ctx.userId, 'LEAD_UPDATED_VIA_COPILOT', { leadId: lead.id, patch: args.patch })
      result = { ok: true, summary: `Lead ${lead.contactName} updated (${Object.keys(args.patch).join(', ')}) and re-assessed.` }
    }
  } else if (pa.toolName === 'record_outcome') {
    const args = JSON.parse(pa.args) as { leadId: string; outcome: 'WON' | 'LOST' | 'OPEN'; dealValue?: number; notes?: string }
    const lead = await db.lead.findFirst({ where: { id: args.leadId, workspaceId: ctx.workspaceId } })
    if (!lead) {
      result = { ok: false, summary: 'Lead no longer exists.' }
    } else {
      const outcome = await db.verifiedOutcome.create({
        data: {
          leadId: lead.id,
          workspaceId: ctx.workspaceId,
          outcome: args.outcome,
          dealValue: args.dealValue ?? null,
          notes: args.notes ?? null,
          occurredAt: new Date(),
          source: 'MANUAL',
          createdById: ctx.userId,
        },
      })
      if (args.outcome !== 'OPEN') {
        await db.lead.update({ where: { id: lead.id }, data: { status: args.outcome } })
      }
      await audit(ctx.workspaceId, ctx.userId, 'OUTCOME_RECORDED_VIA_COPILOT', { leadId: lead.id, outcome: args.outcome })
      result = { ok: true, summary: `Outcome ${args.outcome} recorded for ${lead.contactName}. Future model trainings will include this label.`, data: { outcomeId: outcome.id } }
    }
  } else if (pa.toolName === 'remember_information') {
    const args = JSON.parse(pa.args) as { content: string; leadName?: string; scope?: 'WORKSPACE' | 'LEAD' | 'USER' }
    let leadId: string | null = null
    if (args.leadName) {
      const lead = await db.lead.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          OR: [{ contactName: { contains: args.leadName } }, { company: { is: { name: { contains: args.leadName } } } }],
        },
      })
      leadId = lead?.id ?? null
    }
    const memory = await db.chatMemory.create({
      data: {
        workspaceId: ctx.workspaceId,
        scope: args.scope ?? (leadId ? 'LEAD' : 'WORKSPACE'),
        leadId,
        key: args.content.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40),
        value: args.content,
        source: 'CONVERSATION',
        approved: true, // user explicitly confirmed
        confidence: 0.85,
        createdById: ctx.userId,
      },
    })
    await audit(ctx.workspaceId, ctx.userId, 'MEMORY_STORED_VIA_COPILOT', { id: memory.id })
    result = { ok: true, summary: `Stored in workspace memory (approved): "${args.content}"` }
  } else {
    // Delegate to the generic tool executor for reversible tools
    const res = await executeTool(ctx, pa.toolName, JSON.parse(pa.args))
    result = { ok: res.ok, summary: res.ok ? (res.summary ?? 'completed') : (res.error ?? 'failed'), data: res.data }
  }

  await db.pendingAction.update({
    where: { id: pa.id },
    data: {
      status: result.ok ? 'CONFIRMED' : 'PENDING',
      executedAt: result.ok ? new Date() : null,
      result: JSON.stringify(result),
    },
  })
  return result
}

export async function cancelPendingAction(pendingActionId: string, ctx: ToolContext): Promise<boolean> {
  const pa = await db.pendingAction.findFirst({
    where: { id: pendingActionId, workspaceId: ctx.workspaceId, status: 'PENDING' },
  })
  if (!pa) return false
  await db.pendingAction.update({ where: { id: pa.id }, data: { status: 'CANCELLED' } })
  await audit(ctx.workspaceId, ctx.userId, 'PENDING_ACTION_CANCELLED', { id: pa.id, tool: pa.toolName })
  return true
}
