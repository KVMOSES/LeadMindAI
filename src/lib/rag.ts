import { db } from '@/lib/db'
import { cached } from '@/lib/cache'

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'as', 'by', 'at', 'from', 'this', 'that', 'it', 'its',
  'we', 'you', 'your', 'our', 'their', 'they', 'he', 'she', 'will', 'can', 'should', 'would',
  'not', 'no', 'do', 'does', 'did', 'have', 'has', 'had', 'when', 'what', 'which', 'who', 'how',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/** Splits text into overlapping chunks (~800 chars with 120 overlap). */
export function chunkText(text: string, size = 800, overlap = 120): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= size) return clean.length > 0 ? [clean] : []
  const chunks: string[] = []
  let i = 0
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length)
    // Prefer breaking at a sentence boundary
    if (end < clean.length) {
      const slice = clean.slice(i, end)
      const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'))
      if (lastPeriod > size * 0.5) end = i + lastPeriod + 1
    }
    chunks.push(clean.slice(i, end).trim())
    if (end >= clean.length) break
    i = end - overlap
    if (i < 0) i = 0
  }
  return chunks.filter((c) => c.length > 20)
}

export interface IndexedChunk {
  documentId: string
  documentName: string
  ordinal: number
  text: string
  vector: Map<string, number>
}

interface RagIndex {
  chunks: IndexedChunk[]
  idf: Map<string, number>
}

let indexCacheKey = ''
let indexCache: RagIndex | null = null

async function buildIndex(workspaceId: string): Promise<RagIndex> {
  const docs = await db.knowledgeDocument.findMany({
    where: { workspaceId, status: 'READY' },
    select: { id: true, name: true, createdAt: true, chunkCount: true },
    orderBy: { createdAt: 'asc' },
  })
  const key = `${workspaceId}:${docs.length}:${docs.map((d) => d.createdAt.getTime()).join(',')}`
  if (indexCache && indexCacheKey === key) return indexCache

  const chunksRaw = await db.documentChunk.findMany({
    where: { workspaceId, document: { status: 'READY' } },
    select: { documentId: true, ordinal: true, text: true, document: { select: { name: true } } },
  })
  const docNames = new Map(docs.map((d) => [d.id, d.name]))

  // IDF
  const df = new Map<string, number>()
  for (const c of chunksRaw) {
    const seen = new Set(tokenize(c.text))
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const N = Math.max(chunksRaw.length, 1)
  const idf = new Map<string, number>()
  for (const [t, count] of df) idf.set(t, Math.log((N + 1) / (count + 1)) + 1)

  const chunks: IndexedChunk[] = chunksRaw.map((c) => {
    const tf = new Map<string, number>()
    const tokens = tokenize(c.text)
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    const vector = new Map<string, number>()
    for (const [t, count] of tf) vector.set(t, (count / tokens.length) * (idf.get(t) ?? 1))
    return {
      documentId: c.documentId,
      documentName: docNames.get(c.documentId) ?? 'unknown',
      ordinal: c.ordinal,
      text: c.text,
      vector,
    }
  })

  const idx: RagIndex = { chunks, idf }
  indexCacheKey = key
  indexCache = idx
  return idx
}

export interface KnowledgeHit {
  documentName: string
  chunkOrdinal: number
  text: string
  score: number
}

/** TF-IDF cosine retrieval over the workspace knowledge base. */
export async function retrieveKnowledge(
  workspaceId: string,
  query: string,
  topK = 4,
): Promise<KnowledgeHit[]> {
  return cached(`rag:${workspaceId}:${query}:${topK}`, 20_000, async () => {
    const index = await buildIndex(workspaceId)
    if (index.chunks.length === 0) return []
    const tokens = tokenize(query)
    if (tokens.length === 0) return []
    const qtf = new Map<string, number>()
    for (const t of tokens) qtf.set(t, (qtf.get(t) ?? 0) + 1)
    const qvec = new Map<string, number>()
    for (const [t, c] of qtf) qvec.set(t, (c / tokens.length) * (index.idf.get(t) ?? 1))

    const qNorm = Math.sqrt([...qvec.values()].reduce((a, v) => a + v * v, 0)) || 1
    const scored = index.chunks.map((c) => {
      let dot = 0
      for (const [t, v] of qvec) {
        const cv = c.vector.get(t)
        if (cv) dot += v * cv
      }
      const cNorm = Math.sqrt([...c.vector.values()].reduce((a, v) => a + v * v, 0)) || 1
      return { chunk: c, score: dot / (qNorm * cNorm) }
    })
    return scored
      .filter((s) => s.score > 0.01)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => ({
        documentName: s.chunk.documentName,
        chunkOrdinal: s.chunk.ordinal,
        text: s.chunk.text,
        score: Math.round(s.score * 1000) / 1000,
      }))
  })
}
