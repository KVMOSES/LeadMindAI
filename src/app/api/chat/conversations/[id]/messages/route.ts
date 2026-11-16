import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { runCopilotTurn, llmConfigured, type ChatEvent } from '@/lib/chat/copilot'
import { runDemoTurn } from '@/lib/chat/demo'
import type { ToolContext } from '@/lib/chat/tools'
import type { ToolTrace } from '@/lib/types'

const bodySchema = z.object({
  content: z.string().min(1).max(4000),
  leadContextId: z.string().optional(),
})

/**
 * Streaming Copilot endpoint (SSE over POST).
 * Events: status, tools, delta, pending_action, done, error.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth().catch(() => null)
  if (!ctx) return errorJson('Authentication required', 401)

  const rl = rateLimit(`chat:${ctx.userId}`, 20, 60_000)
  if (!rl.allowed) return errorJson('Chat rate limit reached (20 messages/minute).', 429)

  const { id } = await params
  const conversation = await db.conversation.findFirst({ where: { id, workspaceId: ctx.workspaceId } })
  if (!conversation) return errorJson('Conversation not found', 404)

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch (err) {
    return errorJson(err instanceof z.ZodError ? `Invalid input — ${err.issues.map((i) => i.message).join('; ')}` : 'Invalid input', 400)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
        } catch {
          // client disconnected
        }
      }

      try {
        const llmAvailable = await llmConfigured()
        const mode = llmAvailable ? 'LLM' : 'DEMO'

        // Persist user message
        const userMessage = await db.message.create({
          data: { conversationId: id, role: 'USER', content: body.content },
        })

        // Auto-title from first user message
        const messageCount = await db.message.count({ where: { conversationId: id } })
        if (conversation.title === 'New conversation') {
          await db.conversation.update({
            where: { id },
            data: {
              title: body.content.slice(0, 60).replace(/\s+/g, ' ').trim(),
              mode,
            },
          })
        }

        const history = await db.message.findMany({
          where: { conversationId: id, id: { not: userMessage.id } },
          orderBy: { createdAt: 'asc' },
          take: 12,
          select: { role: true, content: true },
        })

        const toolCtx: ToolContext = {
          workspaceId: ctx.workspaceId,
          workspaceName: ctx.workspaceName,
          userId: ctx.userId,
          role: ctx.role,
          activeLeadId: body.leadContextId ?? null,
          conversationId: id,
        }

        emit({ type: 'status', stage: 'thinking', mode })

        const demoFallback = async () => {
          const demo = await runDemoTurn(toolCtx, body.content, emit)
          // Simulated typing for demo mode (clearly labelled in the banner)
          const chunkSize = 60
          for (let i = 0; i < demo.answer.length; i += chunkSize) {
            emit({ type: 'delta', text: demo.answer.slice(i, i + chunkSize) })
            await new Promise((r) => setTimeout(r, 8))
          }
          return { answer: demo.answer, traces: demo.traces }
        }

        let answer: string
        let traces: ToolTrace[]
        let usedMode: 'LLM' | 'DEMO'
        let model: string

        if (mode === 'LLM') {
          const result = await runCopilotTurn({
            ctx: toolCtx,
            userMessage: body.content,
            history: history.map((h) => ({ role: h.role === 'USER' ? 'user' as const : 'assistant' as const, content: h.content })),
            emit,
            demoFallback,
          })
          answer = result.answer
          traces = result.traces
          usedMode = result.mode
          model = result.model
        } else {
          const demo = await runDemoTurn(toolCtx, body.content, emit)
          answer = demo.answer
          traces = demo.traces
          usedMode = 'DEMO'
          model = 'demo-assistant (local, deterministic)'
          const chunkSize = 60
          for (let i = 0; i < answer.length; i += chunkSize) {
            emit({ type: 'delta', text: answer.slice(i, i + chunkSize) })
            await new Promise((r) => setTimeout(r, 8))
          }
        }

        const assistantMessage = await db.message.create({
          data: {
            conversationId: id,
            role: 'ASSISTANT',
            content: answer,
            toolTraces: JSON.stringify(traces),
            model,
            tokensIn: null,
            tokensOut: null,
          },
        })
        await db.conversation.update({ where: { id }, data: { updatedAt: new Date(), mode: usedMode } })
        emit({
          type: 'done',
          messageId: assistantMessage.id,
          userMessageId: userMessage.id,
          mode: usedMode,
          model,
          traces,
          title: conversation.title === 'New conversation' ? body.content.slice(0, 60).replace(/\s+/g, ' ').trim() : conversation.title,
        })
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Unexpected chat failure' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
