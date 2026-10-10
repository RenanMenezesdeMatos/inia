/**
 * Relatório SOMENTE LEITURA do título exibido, na leitura, para feedbacks de atendimento publicados SEM view model
 * (`legacyFeedbackHeadingOf`): quantos têm vínculo confiável com a interação, quantos ganham o assunto, quantos ficam neutros.
 * Nada é gravado (transação READ ONLY); nenhuma IA; nenhum feedback regenerado ou reenviado.
 *
 *   npx tsx scripts/feedback-engine/legacy-heading-report.ts --organization <id>
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { loadLegacyFeedbackHeadings } from "../../src/modules/feedbacks/infrastructure/legacy-feedback-headings.js"

const args = process.argv.slice(2)
const organizationId = args[args.indexOf("--organization") + 1]
if (!organizationId || !args.includes("--organization")) throw new Error("uso: legacy-heading-report.ts --organization <id>")
const client = await pool.connect()
try {
  await client.query("begin transaction read only")
  const rows = (await client.query<{ id: string; impacted_indicator: string }>(
    `select f.id, f.impacted_indicator from feedbacks f
      where f.organization_id = $1 and f.status = 'PUBLISHED' and f.feedback_kind = 'MONITORING'
        and f.context_snapshot #> '{reliableFeedback,feedbackView}' is null and f.context_snapshot #> '{feedbackEngine,feedbackView}' is null`,
    [organizationId],
  )).rows
  const headings = await loadLegacyFeedbackHeadings(client as never, { organizationId, feedbackIds: rows.map((row) => row.id) })
  const linked = rows.filter((row) => headings.get(row.id)?.linkedInteractionId)
  const withSubject = rows.filter((row) => (headings.get(row.id)?.subjectSource ?? "NONE") !== "NONE")
  const changed = rows.filter((row) => headings.get(row.id)?.title !== row.impacted_indicator)
  const transitions = new Map<string, number>()
  for (const row of rows) {
    const heading = headings.get(row.id)!
    const key = `${row.impacted_indicator.slice(0, 60)} → ${heading.title}${heading.subtitle ? ` | ${heading.subtitle.replace(/\d{2}\/\d{2}\/\d{4}/u, "dd/mm/aaaa")}` : ""} (${heading.subjectSource})`
    transitions.set(key, (transitions.get(key) ?? 0) + 1)
  }
  console.log(JSON.stringify({ legacyMonitoringWithoutView: rows.length, linkedToInteraction: linked.length, withSubject: withSubject.length, linkedWithoutReadableSubject: linked.length - withSubject.length, withoutReliableLink: rows.length - linked.length, displayedTitleChanged: changed.length, bySubjectSource: rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [headings.get(row.id)!.subjectSource]: (acc[headings.get(row.id)!.subjectSource] ?? 0) + 1 }), {}) }, null, 1))
  for (const [key, count] of [...transitions].sort((a, b) => b[1] - a[1])) console.log(`${count}× ${key}`)
  await client.query("rollback")
} finally {
  client.release()
  await pool.end()
}
