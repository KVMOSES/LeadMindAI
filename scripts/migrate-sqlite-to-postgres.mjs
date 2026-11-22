import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { Prisma, PrismaClient } from '@prisma/client'

const sourcePath = resolve(process.env.SQLITE_DATA_PATH || 'db/custom.db')
const batchSize = 500
const dryRun = process.argv.includes('--dry-run')
const modelOrder = [
  'Workspace',
  'User',
  'Company',
  'Session',
  'Membership',
  'Lead',
  'LeadEvent',
  'IcpConfig',
  'IntentConfig',
  'Setting',
  'Assessment',
  'Qualification',
  'Recommendation',
  'ModelVersion',
  'ModelEvaluation',
  'DriftReport',
  'AgentRun',
  'Conversation',
  'ToolExecution',
  'Message',
  'PendingAction',
  'ChatMemory',
  'KnowledgeDocument',
  'DocumentChunk',
  'Feedback',
  'VerifiedOutcome',
  'AuditLog',
]

if (
  !dryRun &&
  !process.env.DATABASE_URL?.startsWith('postgresql://') &&
  !process.env.DATABASE_URL?.startsWith('postgres://')
) {
  throw new Error('Set DATABASE_URL to the Neon PostgreSQL connection string before transferring data.')
}

if (!existsSync(sourcePath)) {
  throw new Error(`SQLite source database does not exist: ${sourcePath}`)
}

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]))
if (models.size !== modelOrder.length || modelOrder.some((name) => !models.has(name))) {
  throw new Error('SQLite transfer model order does not match the Prisma schema.')
}

const sqlite = new Database(sourcePath, { readonly: true, create: false })
const prisma = new PrismaClient()
const quoteIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`
const convertRows = (columns, rows) =>
  rows.map((row) =>
    Object.fromEntries(
      columns.map((field) => {
        const value = row[field.dbName ?? field.name]
        if (value == null) return [field.name, value]
        if (field.type === 'DateTime') {
          const date = new Date(value)
          if (Number.isNaN(date.getTime())) {
            throw new Error(`SQLite contains an invalid date in ${field.name}.`)
          }
          return [field.name, date]
        }
        if (field.type === 'Boolean') return [field.name, Boolean(value)]
        return [field.name, value]
      }),
    ),
  )

try {
  const sqliteTables = new Set(
    sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => name),
  )
  const rowsByModel = new Map()

  for (const modelName of modelOrder) {
    const model = models.get(modelName)
    const tableName = model.dbName ?? model.name
    if (!sqliteTables.has(tableName)) {
      throw new Error(`SQLite source is missing the expected table for ${modelName}.`)
    }

    const columns = model.fields.filter((field) => field.kind === 'scalar')
    const selectRows = sqlite.query(
      `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ? OFFSET ?`,
    )
    const delegate = prisma[modelName[0].toLowerCase() + modelName.slice(1)]
    const count = sqlite.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get().count
    rowsByModel.set(modelName, { columns, count, delegate, model, selectRows, tableName })
  }

  if (dryRun) {
    for (const modelName of modelOrder) {
      const { columns, count, selectRows } = rowsByModel.get(modelName)
      for (let offset = 0; offset < count; offset += batchSize) {
        convertRows(columns, selectRows.all(batchSize, offset))
      }
      console.log(`Dry run ${modelName}: ${count} source row(s) validated`)
    }
  } else {
    for (const modelName of modelOrder) {
      const { count, delegate, selectRows } = rowsByModel.get(modelName)
      for (let offset = 0; offset < count; offset += batchSize) {
        const sourceRows = selectRows.all(batchSize, offset)
        const ids = sourceRows.map(({ id }) => id)
        if (ids.length === 0) continue

        const existing = await delegate.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        })
        if (existing.length > 0) {
          throw new Error(
            `Transfer stopped before writing data: ${modelName} already contains ${existing.length} matching ID(s) in PostgreSQL.`,
          )
        }
      }
      console.log(`Checked ${modelName}: ${count} source row(s)`)
    }

    await prisma.$transaction(
      async (transaction) => {
        for (const modelName of modelOrder) {
          const { columns, count, selectRows } = rowsByModel.get(modelName)
          const delegate = transaction[modelName[0].toLowerCase() + modelName.slice(1)]
          for (let offset = 0; offset < count; offset += batchSize) {
            const sourceRows = selectRows.all(batchSize, offset)
            if (sourceRows.length === 0) continue

            const data = convertRows(columns, sourceRows)
            await delegate.createMany({ data })
          }
          console.log(`Copied ${modelName}: ${count} row(s)`)
        }
      },
      { maxWait: 10_000, timeout: 600_000 },
    )
  }
} finally {
  sqlite.close()
  await prisma.$disconnect()
}
