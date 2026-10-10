/**
 * Saudação dos feedbacks do motor já publicados alinhada à regra atual (`FEEDBACK_GREETING_V1`, só o primeiro nome). Padrão = ENSAIO
 * (nada gravado). `--apply` grava (idempotente; o valor anterior fica em presentationRevisions + audit_logs). Não regenera análise, não
 * reescreve mensagem, não notifica.
 *
 *   npx tsx scripts/feedback-engine/reproject-feedback-greetings.ts --organization <id> [--feedback <id> ...] [--apply]
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { systemClock } from "../../src/shared/domain/clock.js"
import { reprojectFeedbackGreetings } from "../../src/modules/feedback-engine/infrastructure/reproject-feedback-greetings.js"

const args = process.argv.slice(2)
const values = (name: string) => args.flatMap((arg, index) => (arg === `--${name}` && args[index + 1] ? [args[index + 1]!] : []))
const organizationId = values("organization")[0]
if (!organizationId) throw new Error("uso: reproject-feedback-greetings.ts --organization <id> [--feedback <id> ...] [--apply]")
try {
  const result = await reprojectFeedbackGreetings(pool, { organizationId, apply: args.includes("--apply"), actorId: null, clock: systemClock, feedbackIds: values("feedback") })
  const byOutcome = result.rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.outcome]: (acc[row.outcome] ?? 0) + 1 }), {})
  console.log(JSON.stringify({ version: result.version, mode: result.apply ? "APPLY" : "DRY_RUN", examined: result.rows.length, byOutcome, changed: result.changed, applied: result.applied }, null, 1))
  for (const row of result.rows.filter((entry) => entry.outcome === "ADDED" || entry.outcome === "UPDATED")) console.log(`${row.feedbackId}: ${row.before ?? "(sem saudação)"} → ${row.after}`)
} finally {
  await pool.end()
}
