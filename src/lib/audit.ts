import { db } from '@/lib/db'

export async function audit(
  workspaceId: string | null,
  userId: string | null,
  action: string,
  detail?: unknown,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        workspaceId,
        userId,
        action,
        detail: detail === undefined ? null : JSON.stringify(detail),
      },
    })
  } catch {
    // Auditing must never break the primary request.
  }
}
