/**
 * Correção da PROJEÇÃO DO TÍTULO de feedbacks de atendimento já publicados (`FEEDBACK_HEADING_V1`) — título = assunto gravado com a
 * interação vinculada, data como subtítulo. Padrão = ENSAIO (nada gravado). `--apply` grava (idempotente; o cabeçalho anterior fica
 * em presentationRevisions + audit_logs). Não regenera análise, não reescreve mensagem, não notifica.
 *
 *   npx tsx scripts/feedback-engine/reproject-feedback-headings.ts --organization <id> [--feedback <id> ...] [--apply]
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { systemClock } from "../../src/shared/domain/clock.js"
import { reprojectFeedbackHeadings } from "../../src/modules/feedbacks/infrastructure/reproject-feedback-headings.js"

const args = process.argv.slice(2)
const values = (name: string) => args.flatMap((arg, index) => (arg === `--${name}` && args[index + 1] ? [args[index + 1]!] : []))
const organizationId = values("organization")[0]
if (!organizationId) throw new Error("uso: reproject-feedback-headings.ts --organization <id> [--feedback <id> ...] [--apply]")
try {
  const result = await reprojectFeedbackHeadings(pool, { organizationId, apply: args.includes("--apply"), actorId: null, clock: systemClock, feedbackIds: values("feedback") })
  const byOutcome = result.rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.outcome]: (acc[row.outcome] ?? 0) + 1 }), {})
  console.log(JSON.stringify({ version: result.version, mode: result.apply ? "APPLY" : "DRY_RUN", examined: result.rows.length, byOutcome, corrected: result.corrected, applied: result.applied, publishedWithoutViewModel: result.withoutViewModel }, null, 1))
  const shown = new Map<string, number>()
  for (const row of result.rows.filter((entry) => entry.outcome === "CORRECTED")) {
    const key = `${row.before?.title ?? "—"} → ${row.after?.title} | ${row.after?.subtitle} (${row.after?.subjectSource})`
    shown.set(key, (shown.get(key) ?? 0) + 1)
  }
  for (const [key, count] of shown) console.log(`${count}× ${key}`)
} finally {
  await pool.end()
}
