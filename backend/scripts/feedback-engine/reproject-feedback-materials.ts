/**
 * "Materiais utilizados" dos feedbacks do motor alinhados à regra atual (`RECOGNITION_MATERIALS_V1`, composição V28: retorno sem ponto
 * a ajustar mostra os documentos dos acertos confirmados). Padrão = ENSAIO (nada gravado). `--apply` grava (idempotente; o anterior
 * fica em presentationRevisions + audit_logs). Só os materiais mudam: não regenera análise, não reescreve texto, não notifica.
 *
 *   npx tsx scripts/feedback-engine/reproject-feedback-materials.ts --organization <id> [--feedback <id> ...] [--apply]
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { systemClock } from "../../src/shared/domain/clock.js"
import { reprojectFeedbackMaterials } from "../../src/modules/feedback-engine/infrastructure/reproject-feedback-materials.js"

const args = process.argv.slice(2)
const values = (name: string) => args.flatMap((arg, index) => (arg === `--${name}` && args[index + 1] ? [args[index + 1]!] : []))
const organizationId = values("organization")[0]
if (!organizationId) throw new Error("uso: reproject-feedback-materials.ts --organization <id> [--feedback <id> ...] [--apply]")
try {
  const result = await reprojectFeedbackMaterials(pool, { organizationId, apply: args.includes("--apply"), actorId: null, clock: systemClock, feedbackIds: values("feedback") })
  const byOutcome = result.rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.outcome]: (acc[row.outcome] ?? 0) + 1 }), {})
  console.log(JSON.stringify({ version: result.version, mode: result.apply ? "APPLY" : "DRY_RUN", examined: result.rows.length, byOutcome, changed: result.changed, applied: result.applied }, null, 1))
  for (const row of result.rows.filter((entry) => entry.outcome === "UPDATED")) console.log(`${row.kind === "FEEDBACK" ? `feedback ${row.feedbackId}` : `mensagem ${row.messageId} (não entregue)`}: ${row.before.join(" | ") || "(sem materiais)"} → ${row.after.join(" | ") || "(sem materiais)"}`)
} finally {
  await pool.end()
}
