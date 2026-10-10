/**
 * Ocultação LÓGICA de feedbacks no Acompanhamento (migration 095) — seleção EXPLÍCITA por id, nunca por data.
 * Não apaga nem altera o feedback: grava `feedback_follow_up_hides` + `audit_logs`. Idempotente (já oculto = ignorado).
 *
 *   npx tsx scripts/dev/hide-feedbacks-from-follow-up.ts --organization <id> --operator <personId> \
 *     --selection LARISSA_GOLDEN_DEMO_2026_09_29 --reason "Smokes de desenvolvimento da Monitoria por Flag" <feedbackId> [...]
 *
 * `--dry-run` só lista o que seria ocultado.
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { hideFeedbacksFromFollowUp } from "../../src/modules/feedbacks/application/follow-up-visibility.js"
import { systemClock } from "../../src/shared/domain/clock.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args.splice(index, 2)[1] : undefined }
const dryRun = args.includes("--dry-run") ? (args.splice(args.indexOf("--dry-run"), 1), true) : false
const organizationId = option("organization")
const operatorId = option("operator")
const selectionRef = option("selection")
const reason = option("reason")
const feedbackIds = args
if (!organizationId || !operatorId || !selectionRef || !reason || feedbackIds.length === 0) throw new Error("uso: hide-feedbacks-from-follow-up.ts --organization <id> --operator <personId> --selection <REF> --reason <texto> <feedbackId>...")

try {
  const rows = await pool.query(
    `select f.id, f.operator_id, f.feedback_kind, f.status, f.created_at, i.external_id from feedbacks f left join interactions i on i.id::text = f.context_snapshot->>'interactionId' where f.organization_id = $1 and f.id = any($2::uuid[]) order by f.created_at`,
    [organizationId, feedbackIds],
  )
  console.table(rows.rows)
  if (dryRun) process.exit(0)
  const result = await hideFeedbacksFromFollowUp(pool, { organizationId, feedbackIds, expectedOperatorId: operatorId, reasonCode: "DEVELOPMENT_ARTIFACT", reason, selectionRef, actorId: null, clock: systemClock })
  console.log(JSON.stringify(result, null, 2))
} finally {
  await pool.end()
}
