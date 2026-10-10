/**
 * V1.7.4 — REVALIDAÇÃO das observações de processo VERIFIED de MONITORIA sob a verificação nova
 * (`PROCESS_ASSESSMENT_VERIFICATION_V2`: conduta da evidência + semântica da etapa). Sem modelo, sem rede.
 *
 * Por artefato de origem: a MESMA avaliação proposta (normalized_input) passa de novo pela verificação atual, contra a MESMA
 * transcrição e a versão publicada da base; as observações que a verificação nova não produziria mais como VERIFIED (com o mesmo
 * status) deixam de valer para analytics — REJECTED (a etapa não se sustenta mais: ex.: "você verificou a disponibilidade" com uma
 * fala que só afirmava o resultado) ou NEEDS_REVIEW (a etapa continua, mas sem prova autônoma). NUNCA apaga: a linha fica para
 * auditoria, com o motivo acrescentado; a ação vai para `audit_logs`. Idempotente (a segunda rodada não encontra nada).
 *
 * Diagnóstico de indicador (TMA/PRV) está congelado: é só CONTADO no relatório (dry-run), nunca alterado.
 *
 *   npx tsx scripts/dev/revalidate-process-observations.ts            # relatório (nada gravado)
 *   npx tsx scripts/dev/revalidate-process-observations.ts --apply    # aplica só em MONITORIA
 */
import { Pool } from "pg"
import { env } from "../../src/config/env.js"
import { verifyProcessAssessments, type ProcessAssessmentSource } from "../../src/modules/reliable-feedback/domain/process-assessment.js"
import { observationsFrom } from "../../src/modules/indicator-diagnosis/domain/process-patterns.js"
import { createPostgresMonitoringContextLoader, createPostgresPublishedKnowledgeLoader } from "../../src/modules/reliable-feedback/infrastructure/postgres-feedback-context-loaders.js"

const REASON = "REVALIDATED_UNDER_EVIDENCE_CONDUCT_V1"
const apply = process.argv.includes("--apply")
const pool = new Pool({ connectionString: env.DATABASE_URL })

type Row = { id: string; organization_id: string; person_id: string; interaction_id: string; practice_key: string; status: string; document_id: string; document_version: number | null; source_artifact_id: string }
const stored = (await pool.query<Row & { domain: string }>(
  `select o.id, o.organization_id, o.person_id, o.interaction_id, o.practice_key, o.status, o.document_id, o.document_version, o.source_artifact_id, a.domain
   from process_checkpoint_observations o join reliable_feedback_artifacts a on a.id = o.source_artifact_id
   where o.analytics_status = 'VERIFIED'`,
)).rows
const byArtifact = new Map<string, (Row & { domain: string })[]>()
for (const row of stored) byArtifact.set(row.source_artifact_id, [...(byArtifact.get(row.source_artifact_id) ?? []), row])

const loadContext = createPostgresMonitoringContextLoader(pool)
const loadPublished = createPostgresPublishedKnowledgeLoader(pool)
const report = { artifacts: 0, observationsChecked: 0, stillVerified: 0, rejected: [] as { id: string; practiceKey: string; interactionId: string }[], needsReview: [] as { id: string; practiceKey: string; reasons: string[] }[], skippedKnowledgeChanged: 0, indicatorFrozen: 0 }

for (const [artifactId, rows] of byArtifact) {
  if (rows[0]!.domain !== "MONITORING") { report.indicatorFrozen += rows.length; continue }
  const artifact = (await pool.query<{ organization_id: string; collaborator_id: string; interaction_id: string; normalized_input: { processAssessments?: ProcessAssessmentSource[] } }>(`select organization_id, collaborator_id, interaction_id, normalized_input from reliable_feedback_artifacts where id = $1`, [artifactId])).rows[0]
  const sources = artifact?.normalized_input?.processAssessments ?? []
  if (!artifact || sources.length === 0) continue
  const context = await loadContext(artifact.organization_id, artifact.interaction_id, artifact.collaborator_id)
  if (!context) continue
  const documentIds = [...new Set(sources.flatMap((source) => source.presented.map((excerpt) => excerpt.documentId)))]
  const published = await loadPublished(artifact.organization_id, documentIds)
  report.artifacts += 1
  const subject = context.label.includes(" · ") ? context.label.split(" · ").slice(1).join(" · ") : null
  const verified = verifyProcessAssessments({ sources, interactionId: artifact.interaction_id, transcript: context.transcript, published, subject, coveragePlan: true })
  const fresh = new Map(observationsFrom(artifact.collaborator_id, [{ interactionId: artifact.interaction_id, assessment: verified }]).map((observation) => [observation.practiceKey, observation]))
  for (const row of rows) {
    report.observationsChecked += 1
    if (row.document_version !== null && published.get(row.document_id)?.version !== row.document_version) { report.skippedKnowledgeChanged += 1; continue }
    const next = fresh.get(row.practice_key)
    if (next && next.status === row.status && next.analyticsStatus === "VERIFIED") { report.stillVerified += 1; continue }
    if (!next || next.status !== row.status) report.rejected.push({ id: row.id, practiceKey: row.practice_key, interactionId: row.interaction_id })
    else report.needsReview.push({ id: row.id, practiceKey: row.practice_key, reasons: next.analyticsReasons ?? [] })
  }
}

console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", ...report }, null, 2))
if (apply && (report.rejected.length > 0 || report.needsReview.length > 0)) {
  const client = await pool.connect()
  try {
    await client.query("begin")
    for (const entry of report.rejected) await client.query(`update process_checkpoint_observations set analytics_status = 'REJECTED', analytics_reasons = array_append(analytics_reasons, $2), updated_at = now() where id = $1 and analytics_status = 'VERIFIED'`, [entry.id, REASON])
    for (const entry of report.needsReview) await client.query(`update process_checkpoint_observations set analytics_status = 'NEEDS_REVIEW', analytics_reasons = array_cat(analytics_reasons, $2::text[]), updated_at = now() where id = $1 and analytics_status = 'VERIFIED'`, [entry.id, [...entry.reasons, REASON]])
    const organizationId = stored[0]!.organization_id
    for (const entry of [...report.rejected.map((item) => ({ ...item, to: "REJECTED" })), ...report.needsReview.map((item) => ({ ...item, to: "NEEDS_REVIEW" }))]) {
      await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, 'PROCESS_OBSERVATION_REVALIDATED', 'PROCESS_CHECKPOINT_OBSERVATION', $2, $3::jsonb)`, [organizationId, entry.id, JSON.stringify({ from: "VERIFIED", to: entry.to, reason: REASON, practiceKey: entry.practiceKey, verificationVersion: "PROCESS_ASSESSMENT_VERIFICATION_V2" })])
    }
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
await pool.end()
