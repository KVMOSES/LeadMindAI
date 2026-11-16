import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { chunkText } from '@/lib/rag'
import { audit } from '@/lib/audit'

export async function GET() {
  return handle(async () => {
    const ctx = await requireAuth()
    const docs = await db.knowledgeDocument.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        kind: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        chunkCount: true,
        error: true,
        createdAt: true,
      },
    })
    return okJson({ documents: docs })
  })
}

const uploadSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(['PLAYBOOK', 'POLICY', 'PRODUCT', 'OTHER']).default('OTHER'),
  text: z.string().min(10).max(500_000),
})

/**
 * Knowledge ingestion: validates, deduplicates by name, chunks and indexes the
 * document for TF-IDF retrieval. Workspace-isolated.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot upload knowledge', 403)
    const body = uploadSchema.parse(await req.json())

    const dup = await db.knowledgeDocument.findFirst({ where: { workspaceId: ctx.workspaceId, name: body.name } })
    if (dup) return errorJson(`A document named "${body.name}" already exists in this workspace`, 409)

    const chunks = chunkText(body.text)
    if (chunks.length === 0) return errorJson('Document produced no indexable content', 400)

    const doc = await db.knowledgeDocument.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: body.name,
        kind: body.kind,
        mimeType: 'text/plain',
        sizeBytes: body.text.length,
        status: 'READY',
        chunkCount: chunks.length,
        text: body.text.slice(0, 100_000),
      },
    })
    for (let i = 0; i < chunks.length; i++) {
      await db.documentChunk.create({
        data: { documentId: doc.id, workspaceId: ctx.workspaceId, ordinal: i, text: chunks[i] },
      })
    }
    await audit(ctx.workspaceId, ctx.userId, 'KNOWLEDGE_UPLOADED', { id: doc.id, name: body.name, chunks: chunks.length })
    return okJson({ id: doc.id, chunkCount: chunks.length })
  })
}
