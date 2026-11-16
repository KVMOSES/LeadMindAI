import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { toCsv } from '@/lib/csv'
import { requireAuth } from '@/lib/auth'
import { getLeadRows } from '@/lib/analytics'

export async function GET(req: NextRequest) {
  const ctx = await requireAuth().catch(() => null)
  if (!ctx) {
    return new Response('Authentication required', { status: 401 })
  }
  const sp = req.nextUrl.searchParams
  const { allRows } = await getLeadRows(ctx.workspaceId, {
    query: sp.get('query') ?? undefined,
    industry: sp.get('industry') ?? undefined,
    qualification: sp.get('qualification') ?? undefined,
    sort: (sp.get('sort') as 'fit' | undefined) ?? undefined,
    pageSize: 1000,
  })
  const rows: (string | number | null)[][] = [
    ['Company', 'Contact', 'Title', 'Email', 'Industry', 'Employees', 'Revenue band', 'Country', 'Status', 'Source', 'Deal value', 'Fit', 'Intent', 'Conversion %', 'Qualification'],
    ...allRows.map((r) => [
      r.companyName,
      r.contactName,
      r.title,
      r.email,
      r.industry,
      r.employeeCount,
      r.revenueBand,
      r.country,
      r.status,
      r.source,
      r.dealValue,
      r.fit !== null ? Math.round(r.fit) : null,
      r.intent !== null ? Math.round(r.intent) : null,
      r.probability !== null ? Math.round(r.probability * 100) : null,
      r.qualification?.category ?? null,
    ]),
  ]
  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leadmind-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
