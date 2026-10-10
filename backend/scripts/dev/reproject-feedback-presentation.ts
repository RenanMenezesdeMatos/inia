/**
 * Reprojeta a APRESENTAÇÃO de um feedback confiável V2 já publicado (sem IA, sem Workflow): mesmas funções da publicação sobre
 * o artefato e as revisões gravados. O publicado antes vai para `presentationRevisions` + `audit_logs`.
 *
 *   npx tsx scripts/dev/reproject-feedback-presentation.ts --organization <id> --feedback <id> --reason "<texto>" [--dry-run]
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { createPostgresReliableFeedbackStore } from "../../src/modules/reliable-feedback/infrastructure/postgres-reliable-feedback-store.js"
import { reprojectPublishedFeedbackPresentation } from "../../src/modules/reliable-feedback/infrastructure/reproject-published-presentation.js"
import { systemClock } from "../../src/shared/domain/clock.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined }
const organizationId = option("organization")
const feedbackId = option("feedback")
const reason = option("reason")
if (!organizationId || !feedbackId || !reason) throw new Error("uso: reproject-feedback-presentation.ts --organization <id> --feedback <id> --reason <texto> [--dry-run]")
try {
  const result = await reprojectPublishedFeedbackPresentation(pool, createPostgresReliableFeedbackStore(pool), { organizationId, feedbackId, reason, actorId: null, clock: systemClock, dryRun: args.includes("--dry-run") })
  console.log(JSON.stringify({ changed: result.changed, before: result.before, after: result.after }, null, 2))
} finally {
  await pool.end()
}
