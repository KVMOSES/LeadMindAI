import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, okJson, errorJson } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { parseCsvObjects } from '@/lib/csv'
import { audit } from '@/lib/audit'

const bodySchema = z.object({ csv: z.string().min(10).max(2_000_000) })

const numOrNull = (s: string | undefined): number | null => {
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await requireAuth()
    if (ctx.role === 'VIEWER') return errorJson('VIEWER role cannot import leads', 403)
    const { csv } = bodySchema.parse(await req.json())
    const records = parseCsvObjects(csv)
    if (records.length === 0) return errorJson('CSV appears to have no data rows', 400)
    if (records.length > 500) return errorJson('Import limited to 500 rows per request', 400)

    let created = 0
    let skipped = 0
    const errors: string[] = []

    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      const companyName = r['Company'] || r['companyName'] || r['company'] || r['Company Name']
      const contactName = r['Contact'] || r['contactName'] || r['contact'] || r['Contact Name']
      if (!companyName || !contactName) {
        skipped++
        errors.push(`Row ${i + 2}: missing company or contact name`)
        continue
      }
      const email = r['Email'] || r['email'] || null
      if (email) {
        const dup = await db.lead.findFirst({
          where: { workspaceId: ctx.workspaceId, email, company: { is: { name: companyName } } },
        })
        if (dup) {
          skipped++
          continue
        }
      }
      let companyId: string | null = null
      const existingCompany = await db.company.findFirst({ where: { workspaceId: ctx.workspaceId, name: companyName } })
      if (existingCompany) {
        companyId = existingCompany.id
      } else {
        const employees = numOrNull(r['Employees'] || r['employeeCount'] || r['employeeCount'])
        const company = await db.company.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: companyName,
            industry: r['Industry'] || r['industry'] || null,
            employeeCount: employees,
            revenueBand: r['Revenue band'] || r['revenueBand'] || r['RevenueBand'] || null,
            country: r['Country'] || r['country'] || null,
            businessModel: r['Business model'] || r['businessModel'] || null,
            website: r['Website'] || r['website'] || null,
          },
        })
        companyId = company.id
      }
      await db.lead.create({
        data: {
          workspaceId: ctx.workspaceId,
          companyId,
          contactName,
          email,
          title: r['Title'] || r['title'] || null,
          phone: r['Phone'] || r['phone'] || null,
          status: 'NEW',
          source: 'IMPORT',
          dealValue: numOrNull(r['Deal value'] || r['dealValue'] || r['DealValue']),
        },
      })
      created++
    }
    await audit(ctx.workspaceId, ctx.userId, 'LEADS_IMPORTED', { created, skipped })
    return okJson({ created, skipped, errors: errors.slice(0, 10) })
  })
}
