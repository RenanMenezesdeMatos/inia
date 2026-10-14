import { z } from "zod"
import { OPERATIONAL_RESULTS } from "./policy-definition.js"
import type { FormField, InterventionTypeDefinition } from "./intervention-type.js"
import type { ConfigIssue } from "./intervention-type.js"

/**
 * MÁQUINA DE ESTADOS da intervenção — pura. Estados reais: PROPOSED → (AWAITING_APPROVAL) → IN_PROGRESS → COMPLETED | CANCELLED.
 * Atraso NUNCA é estado: é derivado do prazo (`isOverdue`) e convive com o estado real ("Em execução · atrasada").
 */
export const INTERVENTION_STATUSES = ["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number]
export const ACTIVE_STATUSES: readonly InterventionStatus[] = ["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS"]
export const isActiveStatus = (status: string) => (ACTIVE_STATUSES as readonly string[]).includes(status)

export const INTERVENTION_STATUS_LABELS: Record<InterventionStatus, string> = {
  PROPOSED: "Proposta",
  AWAITING_APPROVAL: "Aguardando aprovação",
  IN_PROGRESS: "Em execução",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
}

export type InterventionCommand = "ACCEPT" | "APPROVE" | "RETURN" | "DECIDE_CONTINUITY" | "COMPLETE" | "CANCEL" | "FORWARD"

/** Prazo vencido com a intervenção ainda ativa — data civil da organização (AAAA-MM-DD) comparada como texto. */
export const isOverdue = (status: string, dueAt: string, today: string) => isActiveStatus(status) && dueAt < today

/**
 * DECISÕES da "Solicitar avaliação de continuidade" — vocabulário FECHADO e fixo em código. Nenhuma delas altera situação
 * funcional, cadastro ou acesso do colaborador; "Encaminhar ao processo formal" só registra que o caso segue FORA da INIA, por
 * pessoas. Não existe "aprovar desligamento" (nem por configuração, nem por IA, nem por regra).
 */
export const CONTINUITY_DECISIONS = ["CONTINUITY_CONFIRMED", "DEVELOPMENT_CONTINUES", "REFERRED_TO_FORMAL_PROCESS", "MORE_EVIDENCE_NEEDED"] as const
export type ContinuityDecision = (typeof CONTINUITY_DECISIONS)[number]
export const CONTINUITY_DECISION_LABELS: Record<ContinuityDecision, string> = {
  CONTINUITY_CONFIRMED: "Continuidade confirmada",
  DEVELOPMENT_CONTINUES: "Seguir com o desenvolvimento",
  REFERRED_TO_FORMAL_PROCESS: "Encaminhar ao processo formal (fora da INIA, conduzido por pessoas)",
  MORE_EVIDENCE_NEEDED: "Evidências insuficientes — devolver para complementar",
}
export const CONTINUITY_JUSTIFICATION_MIN = 30

export type TransitionDenial = { code: string; message: string; status: number }
type Transition = { ok: true; to: InterventionStatus } | { ok: false; denial: TransitionDenial }

const deny = (code: string, message: string, status = 409): Transition => ({ ok: false, denial: { code, message, status } })

/** Para onde cada comando leva a partir de cada estado (sem autorização — essa é `authorizeCommand`). */
export function transition(command: InterventionCommand, from: InterventionStatus, input: { approvalRequired: boolean; sensitive: boolean; continuityDecision?: ContinuityDecision }): Transition {
  switch (command) {
    case "ACCEPT":
      if (from !== "PROPOSED") return deny("INTERVENTION_NOT_PROPOSED", "Só uma intervenção proposta pode ser aceita.")
      return { ok: true, to: input.approvalRequired || input.sensitive ? "AWAITING_APPROVAL" : "IN_PROGRESS" }
    case "APPROVE":
      if (input.sensitive) return deny("CONTINUITY_REVIEW_DECISION_ONLY", "A avaliação de continuidade não é aprovada: é decidida por uma pessoa autorizada, com justificativa.", 422)
      if (from !== "AWAITING_APPROVAL") return deny("INTERVENTION_NOT_AWAITING_APPROVAL", "Esta intervenção não está aguardando aprovação.")
      return { ok: true, to: "IN_PROGRESS" }
    case "RETURN":
      if (input.sensitive) return deny("CONTINUITY_REVIEW_DECISION_ONLY", "Use a decisão \"Evidências insuficientes\" para devolver uma avaliação de continuidade.", 422)
      if (from !== "AWAITING_APPROVAL") return deny("INTERVENTION_NOT_AWAITING_APPROVAL", "Esta intervenção não está aguardando aprovação.")
      return { ok: true, to: "PROPOSED" }
    case "DECIDE_CONTINUITY":
      if (!input.sensitive) return deny("INTERVENTION_NOT_CONTINUITY_REVIEW", "Esta intervenção não é uma avaliação de continuidade.", 422)
      if (from !== "AWAITING_APPROVAL") return deny("INTERVENTION_NOT_AWAITING_APPROVAL", "Esta avaliação não está aguardando decisão.")
      if (!input.continuityDecision) return deny("CONTINUITY_DECISION_REQUIRED", "Escolha a decisão.", 422)
      return { ok: true, to: input.continuityDecision === "MORE_EVIDENCE_NEEDED" ? "PROPOSED" : "COMPLETED" }
    case "COMPLETE":
      if (input.sensitive) return deny("CONTINUITY_REVIEW_DECISION_ONLY", "A avaliação de continuidade só termina com a decisão de uma pessoa autorizada.", 422)
      if (from !== "IN_PROGRESS") return deny("INTERVENTION_NOT_IN_PROGRESS", "Só uma intervenção em execução pode ser concluída.")
      return { ok: true, to: "COMPLETED" }
    case "CANCEL":
      if (!isActiveStatus(from)) return deny("INTERVENTION_CLOSED", "A intervenção já está encerrada.")
      return { ok: true, to: "CANCELLED" }
    case "FORWARD":
      if (!isActiveStatus(from)) return deny("INTERVENTION_CLOSED", "A intervenção já está encerrada.")
      return { ok: true, to: from }
  }
}

// ---------------------------------------------------------------------------------------------
// AUTORIZAÇÃO (pura) — quem pode o quê sobre UMA intervenção
// ---------------------------------------------------------------------------------------------

export type ActorRelation = {
  /** A conta é de uma pessoa humana (sessão). Sistema/Workflow/IA nunca passam pelos comandos humanos. */
  human: true
  isResponsible: boolean
  isApprover: boolean
  /** Quem abriu (manual) ou aceitou a proposta — separação de funções na aprovação e na decisão sensível. */
  isOpener: boolean
  /** O próprio colaborador da intervenção. */
  isSubject: boolean
  /** O colaborador está abaixo do viewer na cadeia de gestão (reports_to). */
  leadsSubject: boolean
  /** Permissões com escopo que ALCANÇA o colaborador. */
  can: { view: boolean; execute: boolean; approve: boolean; sensitiveDecide: boolean }
}

export const canViewIntervention = (relation: ActorRelation) =>
  !relation.isSubject && (relation.isResponsible || relation.isApprover || relation.leadsSubject || relation.can.view || relation.can.execute || relation.can.approve || relation.can.sensitiveDecide)

export function authorizeCommand(command: InterventionCommand | "EDIT" | "UPDATE_ITEM" | "ADD_EVIDENCE" | "DRAFT_WITH_AI", relation: ActorRelation, sensitive: boolean): TransitionDenial | null {
  const forbidden = (message: string): TransitionDenial => ({ code: "INTERVENTION_FORBIDDEN", message, status: 403 })
  if (relation.isSubject) return forbidden("Ninguém age sobre a própria intervenção.")
  const executor = relation.isResponsible || relation.can.execute
  switch (command) {
    case "ACCEPT":
    case "COMPLETE":
    case "FORWARD":
    case "EDIT":
    case "UPDATE_ITEM":
    case "ADD_EVIDENCE":
    case "DRAFT_WITH_AI":
      return executor ? null : forbidden("Só o responsável (ou quem tem permissão de executar intervenções no escopo) pode fazer isso.")
    case "CANCEL":
      return executor || (sensitive && relation.can.sensitiveDecide) ? null : forbidden("Só o responsável (ou quem tem permissão de executar intervenções no escopo) pode cancelar.")
    case "APPROVE":
    case "RETURN":
      if (!(relation.isApprover || relation.can.approve)) return forbidden("Só o aprovador designado (ou quem tem permissão de aprovar no escopo) pode decidir esta aprovação.")
      if (relation.isOpener) return forbidden("Quem abriu ou aceitou a intervenção não aprova a própria proposta.")
      return null
    case "DECIDE_CONTINUITY":
      // Nunca pela cadeia hierárquica nem por ser o aprovador: só a permissão sensível, com escopo que alcança o colaborador.
      if (!relation.can.sensitiveDecide) return forbidden("Só uma pessoa com a permissão de decisão sensível, no escopo do colaborador, decide a avaliação de continuidade.")
      if (relation.isOpener) return forbidden("Quem solicitou a avaliação de continuidade não pode decidi-la.")
      return null
  }
}

// ---------------------------------------------------------------------------------------------
// FORMULÁRIO DO TIPO e CONCLUSÃO
// ---------------------------------------------------------------------------------------------

export type FormValues = Record<string, string | number | boolean | null>

export function validateFormValues(fields: readonly FormField[], values: FormValues, options: { requireComplete: boolean }): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const known = new Set(fields.map((field) => field.key))
  for (const key of Object.keys(values)) if (!known.has(key)) issues.push({ path: `formValues.${key}`, code: "INTERVENTION_FORM_UNKNOWN_FIELD", message: `O campo ${key} não existe neste tipo.` })
  for (const field of fields) {
    const value = values[field.key]
    const empty = value === undefined || value === null || (typeof value === "string" && value.trim() === "")
    if (empty) {
      if (field.required && options.requireComplete) issues.push({ path: `formValues.${field.key}`, code: "INTERVENTION_FORM_REQUIRED", message: `Preencha "${field.label}".` })
      continue
    }
    const wrong = (message: string) => issues.push({ path: `formValues.${field.key}`, code: "INTERVENTION_FORM_INVALID", message })
    switch (field.kind) {
      case "TEXT":
        if (typeof value !== "string" || value.length > 300) wrong(`"${field.label}" aceita um texto de até 300 caracteres.`)
        break
      case "LONG_TEXT":
        if (typeof value !== "string" || value.length > 5000) wrong(`"${field.label}" aceita um texto de até 5.000 caracteres.`)
        break
      case "NUMBER":
        if (typeof value !== "number" || !Number.isFinite(value)) wrong(`"${field.label}" precisa ser um número.`)
        break
      case "DATE":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) wrong(`"${field.label}" precisa ser uma data (AAAA-MM-DD).`)
        break
      case "SELECT":
        if (typeof value !== "string" || !(field.options ?? []).includes(value)) wrong(`"${field.label}" precisa ser uma das opções.`)
        break
      case "BOOLEAN":
        if (typeof value !== "boolean") wrong(`"${field.label}" precisa ser sim ou não.`)
        break
    }
  }
  return issues
}

/**
 * Resultado da conclusão — TRÊS coisas separadas, nunca inferidas uma da outra: conclusão das atividades (contada pelo código
 * a partir das tarefas), aprendizagem (avaliação registrada) e evolução OPERACIONAL (leitura do indicador). Tarefa concluída
 * não prova melhora: "melhorou" exige a leitura que sustenta.
 */
export const completionInputSchema = z
  .object({
    note: z.string().trim().max(3000).default(""),
    learning: z.object({ result: z.enum(["ACHIEVED", "PARTIAL", "NOT_ACHIEVED"]), note: z.string().trim().max(2000).default("") }).strict().nullable().default(null),
    operational: z.object({ result: z.enum(OPERATIONAL_RESULTS), reading: z.string().trim().max(2000).default("") }).strict().nullable().default(null),
    formValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  })
  .strict()
export type CompletionInput = z.infer<typeof completionInputSchema>

export type ItemCounts = { tasksTotal: number; tasksDone: number; tasksSkipped: number; checkpointsTotal: number; checkpointsDone: number; activitiesTotal: number; activitiesDone: number }

export function completionIssues(definition: InterventionTypeDefinition, input: CompletionInput, counts: ItemCounts): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const completion = definition.completion
  if (completion.requireAllTasksDone && counts.tasksDone + counts.tasksSkipped < counts.tasksTotal) issues.push({ path: "items", code: "INTERVENTION_TASKS_PENDING", message: `Ainda há ${counts.tasksTotal - counts.tasksDone - counts.tasksSkipped} tarefa(s) pendente(s).` })
  if (completion.requireLearningAssessment && !input.learning) issues.push({ path: "learning", code: "INTERVENTION_LEARNING_REQUIRED", message: "Registre a avaliação de aprendizagem." })
  if (completion.requireOperationalReading && (!input.operational || input.operational.result === "NOT_MEASURED")) issues.push({ path: "operational", code: "INTERVENTION_OPERATIONAL_REQUIRED", message: "Registre a leitura da evolução operacional (o indicador depois da intervenção)." })
  if (input.operational && input.operational.result !== "NOT_MEASURED" && input.operational.reading.trim().length < 10) {
    issues.push({ path: "operational.reading", code: "INTERVENTION_OPERATIONAL_READING", message: "Descreva a leitura do indicador que sustenta o resultado operacional (período, valor antes e depois)." })
  }
  if (completion.requireOutcomeNote && input.note.trim().length === 0) issues.push({ path: "note", code: "INTERVENTION_NOTE_REQUIRED", message: "Registre o resultado da intervenção." })
  issues.push(...validateFormValues(definition.form, input.formValues, { requireComplete: true }))
  return issues
}
