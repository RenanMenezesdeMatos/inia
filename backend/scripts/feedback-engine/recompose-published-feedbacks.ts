/**
 * REFAZ SÓ O TEXTO dos feedbacks do motor já publicados (composição atual: formatação, regras por fonte, todos os ajustes, tabela do
 * resultado), reaproveitando o DIAGNÓSTICO gravado — a análise da chamada (monitoria) e a investigação (indicador) vêm da saída do nó de
 * origem e nunca são refeitas. Paga só redação + verificação (teto de 8 chamadas de modelo por feedback; se o motor tentar mais, a
 * recomposição daquele feedback para e nada é gravado).
 *
 * Padrão = ENSAIO: compõe (PAGO) e mostra o texto novo, sem gravar. `--apply` grava no feedback publicado (view, texto, card do caso) e na
 * mensagem do motor (brief, mensagem, composição, pontos comunicados); o anterior fica em `presentationRevisions` + `audit_logs`
 * (FEEDBACK_TEXT_RECOMPOSED). Não muda ciência, não notifica, não cria feedback novo. Feedback oculto do Acompanhamento é ignorado.
 *
 *   npx tsx scripts/feedback-engine/recompose-published-feedbacks.ts --organization <id> [--feedback <id> ...] [--apply]
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { createEngineDeps, type EngineStores } from "../../src/modules/feedback-engine/application/engine-wiring.js"
import { DEFAULT_ENGINE_BUDGET } from "../../src/modules/feedback-engine/application/engine-meter.js"
import { generateFeedback } from "../../src/modules/feedback-engine/application/generate-feedback.js"
import { createPostgresFeedbackMemoryStore } from "../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { createInMemoryFeedbackMemoryStore } from "../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { deliveredViewOf } from "../../src/modules/feedback-engine/infrastructure/publish-engine-feedback.js"
import { COMPOSITION_VERSION } from "../../src/modules/feedback-engine/domain/versions.js"
import { visibleInFollowUpSql } from "../../src/modules/feedbacks/application/follow-up-visibility.js"

const args = process.argv.slice(2)
const values = (name: string) => args.flatMap((arg, index) => (arg === `--${name}` && args[index + 1] ? [args[index + 1]!] : []))
const organizationId = values("organization")[0]
const apply = args.includes("--apply")
if (!organizationId) throw new Error("uso: recompose-published-feedbacks.ts --organization <id> [--feedback <id> ...] [--apply]")
const only = values("feedback")
const MAX_MODEL_CALLS = 8

type Row = { id: string; case_id: string; operator_id: string; context_snapshot: Record<string, unknown>; recommendation: string }
type MessageRow = { id: string; enrollment_id: string | null; source_node_id: string | null; node_id: string | null; workflow_id: string | null; workflow_version_id: string | null; person_id: string; domain: "MONITORING" | "INDICATOR" }

try {
  const feedbacks = (await pool.query<Row>(
    `select f.id, f.case_id, f.operator_id, f.context_snapshot, f.recommendation
       from feedbacks f
      where f.organization_id = $1 and f.status = 'PUBLISHED'
        and f.context_snapshot #> '{feedbackEngine,feedbackView}' is not null
        and ${visibleInFollowUpSql("f")}
        and ($2::uuid[] is null or f.id = any($2::uuid[]))
      order by coalesce(f.published_at, f.created_at), f.id`,
    [organizationId, only.length > 0 ? only : null],
  )).rows
  let totalCost = 0
  const report: { feedbackId: string; domain: string; outcome: string; costUsd: number | null; modelCalls: number }[] = []
  for (const feedback of feedbacks) {
    const container = (feedback.context_snapshot.feedbackEngine ?? {}) as Record<string, unknown>
    const messageId = typeof container.messageId === "string" ? container.messageId : null
    const message = messageId ? (await pool.query<MessageRow>(`select id, enrollment_id, source_node_id, node_id, workflow_id, workflow_version_id, person_id, domain from feedback_engine_messages where id = $1 and organization_id = $2`, [messageId, organizationId])).rows[0] : undefined
    if (!message?.enrollment_id || !message.source_node_id) {
      report.push({ feedbackId: feedback.id, domain: message?.domain ?? "?", outcome: "SKIPPED_NO_SOURCE", costUsd: null, modelCalls: 0 })
      continue
    }
    const enrollment = (await pool.query<{ node_outputs: Record<string, unknown>; interaction_id: string | null; indicator_measurement_id: string | null }>(`select node_outputs, interaction_id, indicator_measurement_id from workflow_enrollments where id = $1`, [message.enrollment_id])).rows[0]
    const sourceNodeOutput = enrollment?.node_outputs?.[message.source_node_id]
    if (!enrollment || !sourceNodeOutput) {
      report.push({ feedbackId: feedback.id, domain: message.domain, outcome: "SKIPPED_NO_SOURCE_OUTPUT", costUsd: null, modelCalls: 0 })
      continue
    }
    // Memória SOBREPOSTA: lê o que existe, grava em RAM. Este próprio feedback não pode suprimir os pontos nem barrar a recomposição.
    const overlay = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(pool), createInMemoryFeedbackMemoryStore())
    const stores = { ...overlay, deliveredFindings: async () => [], deliveredMonitoringOf: async () => null, deliveredIndicatorPeriods: async () => new Set<string>() } as unknown as EngineStores
    const deps = createEngineDeps({ db: pool, stores, budget: { ...DEFAULT_ENGINE_BUDGET, maxModelCalls: MAX_MODEL_CALLS } })
    let result
    try {
      result = await generateFeedback(deps, {
        organizationId, enrollmentId: null, workflowId: message.workflow_id, workflowVersionId: message.workflow_version_id, nodeId: `recompose-${feedback.id}`, sourceNodeId: message.source_node_id,
        domain: message.domain, sourceNodeOutput, collaboratorId: message.person_id, interactionId: enrollment.interaction_id, indicatorMeasurementId: enrollment.indicator_measurement_id,
        configuredAgentId: null, selectionReason: "Recomposição do texto sobre o diagnóstico já publicado.", now: new Date(),
      })
    } catch (error) {
      const meter = deps.meter.summary() as { costUsd: number | null; calls: number }
      report.push({ feedbackId: feedback.id, domain: message.domain, outcome: `FAILED:${error instanceof Error ? error.message.slice(0, 120) : "?"}`, costUsd: meter.costUsd ?? null, modelCalls: meter.calls })
      totalCost += meter.costUsd ?? 0
      continue
    }
    const meter = deps.meter.summary() as { costUsd: number | null; calls: number }
    totalCost += meter.costUsd ?? 0
    if (result.kind === "ABSTAINED") {
      const abstained = await overlay.getMessage(organizationId, result.messageId)
      const composition = (abstained?.composition ?? {}) as { errors?: string[]; decisions?: { id: string; kept: boolean; reasons: string[] }[]; coherence?: { problems?: { kind: string; note: string | null }[]; danglingAfterRemoval?: string[] } }
      const errors = composition.errors ?? []
      // Sem mensagem: o porquê fica na tela (frases recusadas e o que a conferência do conjunto apontou) — o texto não é gravado.
      const refused = (composition.decisions ?? []).filter((decision) => !decision.kept).map((decision) => `${decision.id}: ${decision.reasons.join(", ")}`)
      console.log(`\n===== ${feedback.id} · SEM MENSAGEM (${result.reason}) =====\nRecusadas: ${refused.join(" | ") || "nenhuma"}\nConjunto: ${JSON.stringify(composition.coherence ?? null)}`)
      report.push({ feedbackId: feedback.id, domain: message.domain, outcome: `ABSTAINED:${result.reason}${errors.length > 0 ? ` [${errors.join(" | ").slice(0, 300)}]` : ""}`, costUsd: meter.costUsd ?? null, modelCalls: meter.calls })
      continue
    }
    const record = await overlay.getMessage(organizationId, result.messageId)
    if (!record?.message || !record.brief) {
      report.push({ feedbackId: feedback.id, domain: message.domain, outcome: "NO_MESSAGE", costUsd: meter.costUsd ?? null, modelCalls: meter.calls })
      continue
    }
    const view = await deliveredViewOf(pool, organizationId, feedback.operator_id, record.message.view)
    const readability = (record.composition as { readability?: { wordsPerSentence: number; fleschPt: number } | null } | null)?.readability
    console.log(`\n===== ${feedback.id} · ${message.domain} =====\nCARD: ${record.message.card}${readability ? `\nLEITURA: ${readability.wordsPerSentence} palavras por frase · índice ≈ ${readability.fleschPt}` : ""}\n\n${view.narrative.join("\n\n")}`)
    report.push({ feedbackId: feedback.id, domain: message.domain, outcome: apply ? "APPLIED" : "COMPOSED_DRY_RUN", costUsd: meter.costUsd ?? null, modelCalls: meter.calls })
    if (!apply) continue
    const brief = record.brief
    const findings = [...brief.developments, ...brief.strengths]
    const at = new Date()
    const revisions = Array.isArray(container.presentationRevisions) ? container.presentationRevisions : []
    const snapshot = {
      ...feedback.context_snapshot,
      feedbackEngine: {
        ...container,
        tone: brief.tone,
        limited: brief.tone === "INFORMATIVE",
        findings: findings.map((finding) => ({ kind: finding.kind, origin: finding.origin, title: finding.title, materiality: finding.materiality, criterionKeys: finding.criterionKeys })),
        suppressed: brief.suppressed,
        source: record.message.source,
        feedbackView: view,
        presentationRevisions: [...revisions, { replacedAt: at.toISOString(), reason: `TEXT_RECOMPOSED:${COMPOSITION_VERSION}`, previous: { feedbackView: container.feedbackView ?? null, recommendation: feedback.recommendation } }],
      },
    }
    const client = await pool.connect()
    try {
      await client.query("begin")
      const updated = await client.query(`update feedbacks set context_snapshot = $2::jsonb, recommendation = $3, updated_at = $4 where id = $1 and organization_id = $5 and context_snapshot = $6::jsonb`, [feedback.id, JSON.stringify(snapshot), record.message.text, at, organizationId, JSON.stringify(feedback.context_snapshot)])
      if (updated.rowCount !== 1) {
        await client.query("rollback")
        report[report.length - 1]!.outcome = "SKIPPED_CHANGED_DURING_RUN"
        continue
      }
      const previousCase = (await client.query<{ summary: string | null }>(`select summary from supervision_cases where id = $1`, [feedback.case_id])).rows[0]
      await client.query(`update supervision_cases set summary = $2, updated_at = $3 where id = $1 and organization_id = $4`, [feedback.case_id, record.message.card, at, organizationId])
      const previousMessage = (await client.query<{ message: unknown; composition: unknown; finding_keys: string[] }>(`select message, composition, finding_keys from feedback_engine_messages where id = $1`, [message.id])).rows[0]
      await client.query(`update feedback_engine_messages set brief = $2, message = $3, composition = $4, finding_keys = $5 where id = $1 and organization_id = $6`, [message.id, JSON.stringify(record.brief), JSON.stringify(record.message), JSON.stringify(record.composition ?? null), record.findingKeys ?? [], organizationId])
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, null, 'FEEDBACK_TEXT_RECOMPOSED', 'FEEDBACK', $2, $3, $4)`,
        [organizationId, feedback.id, JSON.stringify({ compositionVersion: COMPOSITION_VERSION, messageId: message.id, costUsd: meter.costUsd ?? null, modelCalls: meter.calls, previousCard: previousCase?.summary ?? null, previousFindingKeys: previousMessage?.finding_keys ?? [], previousMessage: previousMessage?.message ?? null }), at],
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
  console.log("\n" + JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", examined: feedbacks.length, totalCostUsd: Math.round(totalCost * 10_000) / 10_000, report }, null, 1))
} finally {
  await pool.end()
}
