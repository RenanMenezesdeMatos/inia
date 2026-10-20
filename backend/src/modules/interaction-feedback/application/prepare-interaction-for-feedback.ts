import type { Database } from "../../../infrastructure/database/pool.js"
import { readableSubjectOf } from "../../feedbacks/domain/feedback-heading.js"
import { personMentionRolesOf } from "../../investigation/domain/person-mention-roles.js"
import { analyzeInteractionSemantics } from "../../investigation/application/tools/interaction-tools.js"
import { defaultInvestigationToolState, loadSubject, type InvestigationRequest, type ToolContext } from "../../investigation/application/tool-context.js"
import { HandleRegistry } from "../../investigation/domain/handle-registry.js"
import { composeInteractionFeedback, documentIdResolverFromHandles, proceduralLineageFromEvaluations, type InteractionFeedbackV1 } from "../../investigation/domain/interaction-feedback.js"
import { canonicalSubjectSql, rawSubjectSql } from "../../interactions/domain/interaction-subject.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf, startOfLocalDate } from "../../workflows/application/time-window.js"
import { loadLatestTranscriptForModel } from "../../workflows/application/transcript.js"
import type { RunContext } from "./ports.js"

/**
 * V1.5.10 — PrepareInteractionForFeedback: UMA interação elegível → o contrato que o InteractionFeedbackPipeline consome
 * (`InteractionFeedbackV1` + `RunContext`). Caminho semântico DIRETO: Fase A (frames) → Fase B (findings/patterns) →
 * sidecar de atribuição → Fase K procedimental → composição determinística. Os prompts, verificadores e regras são
 * EXATAMENTE os de `analyze_interactions` (`analyzeInteractionSemantics`, sem cópia).
 *
 * NÃO faz: planejamento de investigação (nenhuma request de PLANNING — o Planner custa ~21× este caminho, auditoria
 * V1.5.0a), decisão de entrega, redação, entrega, nem nada do Workflow. Sem Agent: a Fase K não busca em base nenhuma
 * (divergência procedimental já é bloqueada para o colaborador; a comparação com a base fica para quando o nó tiver uma
 * base autorizada explícita).
 */
export const INTERACTION_FEEDBACK_ANALYSIS_OBJECTIVE =
  "Feedback individual desta interação: observar a condução do atendimento pelo operador — o que foi feito bem e o que pode melhorar — somente com base no que a conversa mostra."

export type PreparedInteraction =
  | { kind: "PREPARED"; feedback: InteractionFeedbackV1; runContext: RunContext; requests: InvestigationRequest[] }
  | { kind: "NOT_ANALYZABLE"; reason: "NO_TRANSCRIPT"; requests: InvestigationRequest[] }

export type PrepareErrorCode = "INTERACTION_NOT_FOUND" | "INTERACTION_NOT_OWNED_BY_COLLABORATOR" | "SEMANTIC_ANALYSIS_FAILED"
/** Falha TÉCNICA/de contrato (≠ resultado funcional): quem chama decide o retry (no Workflow, o mecanismo normal do motor). */
export class PrepareInteractionError extends Error {
  constructor(public readonly code: PrepareErrorCode, message: string) {
    super(message)
    this.name = code
  }
}

export type PrepareInput = { organizationId: string; collaboratorId: string; interactionId: string; now: Date }

export async function prepareInteractionForFeedback(db: Database, input: PrepareInput): Promise<PreparedInteraction> {
  // Segurança: a interação precisa existir NESTA organização e pertencer ao colaborador — nunca um id arbitrário.
  const row = await db.query<{ id: string; operator_id: string; started_at: Date; reason: string; team_id: string | null; subject_code: string | null }>(
    `select i.id, i.operator_id, i.started_at, ${rawSubjectSql("i")} reason, p.team_id, ${canonicalSubjectSql("i")} subject_code
     from interactions i join people p on p.id = i.operator_id
     where i.id = $1 and i.organization_id = $2 and p.organization_id = $2`,
    [input.interactionId, input.organizationId],
  )
  const interaction = row.rows[0]
  if (!interaction) throw new PrepareInteractionError("INTERACTION_NOT_FOUND", "Interação não encontrada nesta organização.")
  if (interaction.operator_id !== input.collaboratorId) throw new PrepareInteractionError("INTERACTION_NOT_OWNED_BY_COLLABORATOR", "A interação não pertence ao colaborador desta execução.")

  const transcript = await loadLatestTranscriptForModel(db, interaction.id)
  if (!transcript || transcript.content.trim().length === 0) return { kind: "NOT_ANALYZABLE", reason: "NO_TRANSCRIPT", requests: [] }

  const timeZone = await resolveOrganizationTimezone(db, input.organizationId)
  const startedAt = new Date(interaction.started_at)
  const localDate = localDateOf(startedAt, timeZone)
  const dayStart = startOfLocalDate(localDate, timeZone)
  const context: ToolContext = {
    db,
    organizationId: input.organizationId,
    agentId: null,
    semanticFlow: "INTERACTION_FEEDBACK",
    now: input.now,
    timeZone,
    subject: await loadSubject(db, input.organizationId, input.collaboratorId, { interactionId: interaction.id }),
    defaultPeriod: { start: dayStart, end: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000), label: localDate },
    workdayCache: new Map(),
    knowledgeCandidates: new Map(),
    knowledgeExcerpts: new Map(),
    collectedFacts: [],
    telemetry: { requests: [] },
    handles: new HandleRegistry(),
    investigation: defaultInvestigationToolState(),
  }

  const analysis = await analyzeInteractionSemantics(context, [{ id: interaction.id, content: transcript.content, reason: interaction.reason, operatorId: interaction.operator_id, startedAt: startedAt.toISOString() }], INTERACTION_FEEDBACK_ANALYSIS_OBJECTIVE)
  // Resposta do modelo sem contrato (JSON inválido nas duas tentativas da Fase A): falha técnica — o retry do motor decide.
  if (!analysis.semantic) throw new PrepareInteractionError("SEMANTIC_ANALYSIS_FAILED", "A análise semântica não devolveu frames válidos.")
  const handle = context.handles.handleOf("I", interaction.id)
  const frame = analysis.semantic.frames.find((entry) => entry.interactionRef === handle) ?? analysis.semantic.frames[0]
  if (!frame) throw new PrepareInteractionError("SEMANTIC_ANALYSIS_FAILED", "A análise semântica não devolveu o frame da interação.")

  const feedback = composeInteractionFeedback({
    subject: { collaboratorRef: input.collaboratorId },
    frame,
    interactionLabel: await interactionLabelOf(db, input.organizationId, localDate, interaction.subject_code, interaction.reason),
    sourceRun: `interaction-feedback:${interaction.id}`,
    proceduralLineage: proceduralLineageFromEvaluations(analysis.procedural?.evaluations ?? [], documentIdResolverFromHandles(context.handles.entries())),
    displayContext: { otherOperatorNames: await otherOperatorNamesOf(db, input.organizationId, input.collaboratorId, interaction.team_id), mentionRoles: personMentionRolesOf(transcript.content, await subjectOperatorNameOf(db, input.organizationId, input.collaboratorId)) },
  })
  return {
    kind: "PREPARED",
    feedback,
    runContext: { organizationId: input.organizationId, collaboratorId: input.collaboratorId, teamId: interaction.team_id, interactionId: interaction.id, occurredAt: startedAt },
    requests: context.telemetry.requests,
  }
}

/** Rótulo EXIBÍVEL: data local + nome do assunto canônico quando existe — nunca o código bruto nem identificador. */
/**
 * Rótulo "Atendimento de dd/mm/aaaa · <assunto>" (`FEEDBACK_HEADING_V2`): assunto canônico quando resolve; senão o assunto BRUTO
 * gravado com a interação (o submotivo, quando a fonte o informou; senão o motivo), se legível (ou o nome do assunto com exatamente
 * aquele código); sem assunto confiável, só a data.
 * Antes, sem alias canônico o assunto bruto era descartado e o título do feedback virava só a data.
 */
export async function interactionLabelOf(db: Database, organizationId: string, localDate: string, subjectCode: string | null, rawSubject: string | null = null): Promise<string> {
  const [year, month, day] = localDate.split("-")
  const date = `${day}/${month}/${year}`
  const nameOf = async (code: string) => (await db.query<{ name: string }>(`select name from interaction_subject_definitions where organization_id = $1 and code = $2 and active`, [organizationId, code])).rows[0]?.name ?? null
  const canonicalName = subjectCode ? await nameOf(subjectCode) : null
  const raw = rawSubject?.trim() ?? ""
  const exactCodeName = !canonicalName && raw ? await nameOf(raw) : null
  const subject = readableSubjectOf({ canonicalName, raw, nameOfCode: () => exactCodeName })
  return subject ? `Atendimento de ${date} · ${subject.text}` : `Atendimento de ${date}`
}

/** Outros operadores do Grupo: se um trecho menciona um deles (transferência, menção), a evidência não é exibida. */
/** V1.7.1g — nome do PRÓPRIO colaborador (a pessoa nunca é "outro operador" nas menções da própria chamada). */
export async function subjectOperatorNameOf(db: Database, organizationId: string, collaboratorId: string): Promise<string | null> {
  const person = await db.query<{ name: string }>(`select name from people where organization_id = $1 and id = $2`, [organizationId, collaboratorId])
  return person.rows[0]?.name ?? null
}

export async function otherOperatorNamesOf(db: Database, organizationId: string, collaboratorId: string, teamId: string | null): Promise<string[]> {
  if (!teamId) return []
  const people = await db.query<{ name: string }>(`select name from people where organization_id = $1 and team_id = $2 and id <> $3 and active`, [organizationId, teamId, collaboratorId])
  return people.rows.map((person) => person.name)
}
