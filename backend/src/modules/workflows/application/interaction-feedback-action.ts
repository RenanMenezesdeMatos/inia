import type { ActionConfig } from "../domain/graph-schema.js"
import type { ActionExecutionContext, ActionResult } from "./action-executors.js"
import { resolvePeriodWindow } from "./action-executors.js"
import { resolveEnrollmentOperatorId } from "./enrollment-subject.js"
import { resolveOrganizationTimezone } from "./organization-timezone.js"
import { interactionFeedbackModuleEnabled } from "../../interaction-feedback/application/pipeline-wiring.js"
import type { GenerationOutcome, GenerationRequest } from "../../interaction-feedback/application/generate-interaction-feedback.js"
import { INTERACTION_FEEDBACK_CONTRACT, selectInteractions, selectionSeedOf } from "../../interaction-feedback/domain/interaction-selection.js"

/**
 * V1.5.10 — ação "Gerar feedback de atendimento" (INTERACTION FEEDBACK V1). NÃO é o feedback de monitoria legado de
 * "Chamar agente" (LEGACY MONITORING FEEDBACK: Agent + Output → `feedbacks`); os dois só coexistem num Workflow se o admin
 * configurar os dois nós.
 *
 *   colaborador da execução → interação(ões) (do gatilho, ou amostra reproduzível e PERSISTIDA do colaborador)
 *     → para cada uma: geração idempotente (PrepareInteractionForFeedback → pipeline → política de entrega)
 *
 * AUTO_DELIVER / HOLD_FOR_QA / BLOCKED / NOT_ANALYZABLE são RESULTADOS FUNCIONAIS: a ação conclui e o Workflow segue — a
 * entrega é do varredor, o QA é exceção posterior (o Workflow nunca espera por ele). Falha técnica (provider, banco,
 * contrato do modelo, outra execução gerando a mesma interação) é lançada: o motor aplica o retry/backoff de sempre.
 * Interação que já tem feedback deste nó é reaproveitada (nunca um segundo feedback).
 */
export type InteractionFeedbackActionOutput = {
  kind: "INTERACTION_FEEDBACK"
  contract: typeof INTERACTION_FEEDBACK_CONTRACT
  source: "TRIGGER_INTERACTION" | "COLLABORATOR_SAMPLE"
  collaboratorId: string
  selection: { strategy: "MOST_RECENT" | "DETERMINISTIC_SAMPLE" | null; window: { start: string; end: string } | null; candidateCount: number | null; selectedCount: number; persisted: boolean }
  results: GenerationOutcome[]
  totals: { interactions: number; generated: number; reused: number; notAnalyzable: number; autoDeliver: number; holdForQa: number; blocked: number }
}

type Config = Extract<ActionConfig, { actionType: "GENERATE_INTERACTION_FEEDBACK" }>

export async function executeGenerateInteractionFeedback(config: Config, context: ActionExecutionContext): Promise<ActionResult> {
  // Flag desligada = o módulo não existe neste ambiente: nada roda (o publish já recusa; aqui é defesa para Workflow publicado antes).
  if (!interactionFeedbackModuleEnabled()) throw new Error("O feedback de atendimento está desligado neste ambiente — a ação não pode ser executada.")
  const collaboratorId = await resolveEnrollmentOperatorId({ db: context.db, enrollment: context.enrollment })
  if (!collaboratorId) throw new Error("Não foi possível identificar o colaborador desta execução para gerar o feedback de atendimento.")
  const person = await context.db.query<{ id: string }>(`select id from people where id = $1 and organization_id = $2`, [collaboratorId, context.organizationId])
  if (!person.rows[0]) throw new Error("O colaborador desta execução não pertence à organização do Workflow.")

  const source = config.interactionSource
  const scope = { organizationId: context.organizationId, workflowId: context.workflowId, nodeId: context.nodeId }
  const intent = (enrollmentId: string | null) => ({ kind: "WORKFLOW_ACTION" as const, workflowId: context.workflowId, workflowVersionId: context.workflowVersionId, nodeId: context.nodeId, enrollmentId })
  let selected: string[]
  let selection: InteractionFeedbackActionOutput["selection"]
  let requestOf: (interactionId: string, rank: number) => GenerationRequest

  if (source.kind === "TRIGGER_INTERACTION") {
    // A interação do gatilho É a interação relevante — nunca sortear outra.
    if (!context.enrollment.interactionId) throw new Error("Esta execução não tem uma interação de gatilho — \"Interação que disparou o Workflow\" exige gatilho por Flag.")
    selected = [context.enrollment.interactionId]
    selection = { strategy: null, window: null, candidateCount: null, selectedCount: 1, persisted: false }
    requestOf = (interactionId) => ({ organizationId: context.organizationId, collaboratorId, interactionId, intent: intent(context.enrollment.id), selection: { source: "TRIGGER_INTERACTION", strategy: null, rank: null } })
  } else {
    const timeZone = await resolveOrganizationTimezone(context.db, context.organizationId)
    const window = resolvePeriodWindow(source.period, context.now, "PREVIOUS", timeZone)
    requestOf = (interactionId, rank) => ({ organizationId: context.organizationId, collaboratorId, interactionId, intent: intent(context.enrollment.id), selection: { source: "COLLABORATOR_SAMPLE", strategy: source.strategy, rank } })
    // Retry da MESMA execução: relê a seleção reservada — nunca reescolhe.
    const persisted = await context.effects.interactionFeedback.persistedSelection(context.db, { ...scope, enrollmentId: context.enrollment.id })
    if (persisted.length > 0) {
      selected = persisted
      selection = { strategy: source.strategy, window: { start: window.start.toISOString(), end: window.end.toISOString() }, candidateCount: null, selectedCount: persisted.length, persisted: true }
    } else {
      // Candidatas: interações do colaborador, na janela, com transcrição; fora as que este nó já atendeu.
      const candidates = await context.db.query<{ id: string; started_at: Date }>(
        `select i.id, i.started_at from interactions i
         where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4
           and exists (select 1 from transcripts t where t.interaction_id = i.id)
         order by i.started_at desc, i.id`,
        [context.organizationId, collaboratorId, window.start.toISOString(), window.end.toISOString()],
      )
      const alreadySelected = new Set(await context.effects.interactionFeedback.selectedInteractionIds(context.db, scope))
      const eligible = candidates.rows.filter((row) => !alreadySelected.has(row.id)).map((row) => ({ id: row.id, startedAt: new Date(row.started_at) }))
      const chosen = selectInteractions(eligible, { strategy: source.strategy, size: source.sampleSize, seed: selectionSeedOf({ enrollmentId: context.enrollment.id, collaboratorId, window }) })
      selected = chosen.length > 0 ? await context.effects.interactionFeedback.reserveSelection(context.db, chosen.map((interactionId, index) => requestOf(interactionId, index + 1))) : []
      selection = { strategy: source.strategy, window: { start: window.start.toISOString(), end: window.end.toISOString() }, candidateCount: eligible.length, selectedCount: selected.length, persisted: selected.length > 0 }
    }
  }

  // Sequencial e na ordem da seleção: cada interação é uma geração própria (as já concluídas são reaproveitadas no retry).
  const results: GenerationOutcome[] = []
  for (const [index, interactionId] of selected.entries()) results.push(await context.effects.interactionFeedback.generate(context.db, requestOf(interactionId, index + 1)))

  const sum = (pick: (outcome: GenerationOutcome) => number) => results.reduce((total, outcome) => total + pick(outcome), 0)
  const nodeOutput: InteractionFeedbackActionOutput = {
    kind: "INTERACTION_FEEDBACK",
    contract: INTERACTION_FEEDBACK_CONTRACT,
    source: source.kind,
    collaboratorId,
    selection,
    results,
    totals: {
      interactions: results.length,
      generated: results.filter((outcome) => outcome.status === "GENERATED" && !outcome.reused).length,
      reused: results.filter((outcome) => outcome.reused).length,
      notAnalyzable: results.filter((outcome) => outcome.status === "NOT_ANALYZABLE").length,
      autoDeliver: sum((outcome) => outcome.dispositions.AUTO_DELIVER),
      holdForQa: sum((outcome) => outcome.dispositions.HOLD_FOR_QA),
      blocked: sum((outcome) => outcome.dispositions.BLOCKED),
    },
  }
  return { nodeOutput }
}
