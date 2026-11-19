import { z } from "zod"
import { escalationRoleSchema, type EscalationRole } from "../../workflows/domain/escalation-role-schema.js"
import { addCivilDays } from "./evolution.js"
import { CAPABILITY_DEFINITIONS, EVIDENCE_KINDS, INTERVENTION_CAPABILITIES, effectiveCapabilities, type InterventionCapability } from "./capabilities.js"

/**
 * TIPO DE INTERVENÇÃO — contrato declarativo versionado (`INTERVENTION_TYPE_V1`). Tudo é dado tipado e validado: nenhum script,
 * SQL ou expressão. A chave estável (`key`) fica no cabeçalho (`intervention_types`); isto é o conteúdo de UMA versão.
 */
export const INTERVENTION_TYPE_SCHEMA_VERSION = "INTERVENTION_TYPE_V1" as const

export const STABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/
export const stableKeySchema = z.string().trim().regex(STABLE_KEY_PATTERN, "Use letras maiúsculas, números e _ (2 a 40 caracteres, começando por letra).")

/**
 * Quem executa: o LÍDER DIRETO do colaborador (quem ele reporta, qualquer que seja o nível) ou o primeiro na cadeia com um
 * nível hierárquico. Mesma cadeia (`reports_to`) do Escalar/Revisão humana — nunca uma lista de pessoas na configuração.
 */
export const RESPONSIBLE_ROLES = ["DIRECT_LEADER", ...escalationRoleSchema.options] as const
export const responsibleRoleSchema = z.enum(RESPONSIBLE_ROLES)
export type ResponsibleRole = z.infer<typeof responsibleRoleSchema>
export const RESPONSIBLE_ROLE_LABELS: Record<ResponsibleRole, string> = {
  DIRECT_LEADER: "Líder direto",
  COORDINATOR: "Coordenador",
  SUPERVISOR: "Supervisor",
  MANAGER: "Gerente",
  SENIOR_MANAGER: "Gerente sênior",
  DIRECTOR: "Diretor",
} satisfies Record<"DIRECT_LEADER" | EscalationRole, string>

export const FORM_FIELD_KINDS = ["TEXT", "LONG_TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN"] as const
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number]

const formFieldSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, "A chave do campo começa com letra minúscula e usa letras, números e _."),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(FORM_FIELD_KINDS),
    required: z.boolean(),
    help: z.string().trim().max(300).optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  })
  .strict()
export type FormField = z.infer<typeof formFieldSchema>

/**
 * ROTEIRO do formato — os passos com que a intervenção JÁ NASCE (ex.: lado a lado = três sessões e um checkpoint), para o líder
 * receber o acompanhamento proposto em vez de montá-lo do zero. Cada passo vira um item (tarefa ou checkpoint) com dono e prazo;
 * o líder ajusta, inclui e dispensa itens como sempre. Campo acrescentado em 18/11/2026: versões publicadas antes não o têm e
 * valem como roteiro vazio.
 */
export const SCRIPT_STEP_KINDS = ["TASK", "CHECKPOINT"] as const
export const SCRIPT_STEP_OWNERS = ["RESPONSIBLE", "COLLABORATOR"] as const
export const MAX_SCRIPT_STEPS = 12
const scriptStepSchema = z
  .object({
    kind: z.enum(SCRIPT_STEP_KINDS),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000),
    /** Quem faz o passo: o responsável pela intervenção (quem lidera) ou o próprio colaborador. */
    owner: z.enum(SCRIPT_STEP_OWNERS),
    /** Prazo do passo, em dias depois da abertura. null = o prazo da própria intervenção. */
    dueInDays: z.number().int().min(1).max(365).nullable(),
  })
  .strict()
export type ScriptStep = z.infer<typeof scriptStepSchema>

const approvalSchema = z.discriminatedUnion("required", [
  z.object({ required: z.literal(false) }).strict(),
  // Quem aprova é resolvido pela CADEIA do colaborador (reports_to), com o mesmo resolvedor do Escalonar/Revisão humana.
  z.object({ required: z.literal(true), approverRole: escalationRoleSchema }).strict(),
])

export const interventionTypeDefinitionSchema = z
  .object({
    schemaVersion: z.literal(INTERVENTION_TYPE_SCHEMA_VERSION),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    capabilities: z.array(z.enum(INTERVENTION_CAPABILITIES)).min(1).max(INTERVENTION_CAPABILITIES.length),
    /** Quem executa: o líder direto do colaborador ou o primeiro na cadeia com este nível hierárquico. */
    responsibleRole: responsibleRoleSchema,
    defaultDueDays: z.number().int().min(1).max(365),
    approval: approvalSchema,
    evidence: z.object({ minimumItems: z.number().int().min(0).max(10), acceptedKinds: z.array(z.enum(EVIDENCE_KINDS)).min(1) }).strict(),
    form: z.array(formFieldSchema).max(20),
    completion: z
      .object({
        requireAllTasksDone: z.boolean(),
        requireLearningAssessment: z.boolean(),
        requireOperationalReading: z.boolean(),
        requireOutcomeNote: z.boolean(),
      })
      .strict(),
    /** Chaves de outros tipos que não podem estar ativos ao mesmo tempo para a mesma pessoa (checagem simétrica). */
    incompatibleWith: z.array(stableKeySchema).max(20),
    /** Permite pedir à IA um RASCUNHO (treinamento ou plano) com fontes; o rascunho passa pelas aprovações do tipo. */
    aiDraft: z.boolean(),
    /** Roteiro de passos com que a intervenção nasce (vazio = sem roteiro). */
    script: z.array(scriptStepSchema).max(MAX_SCRIPT_STEPS).default([]),
    /**
     * O colaborador VÊ o acompanhamento em execução no Acompanhamento dele (o combinado e os passos) e marca os próprios passos.
     * Nunca vê o motivo, a análise, o relatório nem as anotações de quem conduz. Campo de 18/11/2026: versões anteriores valem
     * como "não visível".
     */
    collaboratorVisible: z.boolean().default(false),
  })
  .strict()
export type InterventionTypeDefinition = z.infer<typeof interventionTypeDefinitionSchema>

export type ConfigIssue = { path: string; code: string; message: string }

/**
 * Validação de COMBINAÇÃO (além do formato) — o que torna um tipo publicável. Pura: as chaves de tipos existentes vêm de fora.
 * A capacidade CONTINUITY_REVIEW tem regras FIXAS (`continuityReviewIssues`) que nenhuma configuração desliga.
 */
export function validateInterventionType(definition: InterventionTypeDefinition, ownKey: string, knownTypeKeys: ReadonlySet<string>): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const capabilities = effectiveCapabilities(definition.capabilities)
  const has = (capability: InterventionCapability) => capabilities.includes(capability)

  const fieldKeys = new Set<string>()
  definition.form.forEach((field, index) => {
    if (fieldKeys.has(field.key)) issues.push({ path: `form.${index}.key`, code: "TYPE_FORM_FIELD_DUPLICATED", message: `O campo "${field.key}" aparece mais de uma vez no formulário.` })
    fieldKeys.add(field.key)
    if (field.kind === "SELECT" && (!field.options || field.options.length < 2)) issues.push({ path: `form.${index}.options`, code: "TYPE_FORM_SELECT_OPTIONS", message: `O campo "${field.label}" é uma lista e precisa de pelo menos duas opções.` })
    if (field.kind !== "SELECT" && field.options) issues.push({ path: `form.${index}.options`, code: "TYPE_FORM_OPTIONS_UNEXPECTED", message: `Só campos do tipo lista têm opções ("${field.label}").` })
  })

  if (definition.completion.requireAllTasksDone && !has("TASKS")) issues.push({ path: "completion.requireAllTasksDone", code: "TYPE_COMPLETION_NEEDS_TASKS", message: "Exigir todas as tarefas concluídas só faz sentido com a capacidade Tarefas." })
  if (definition.completion.requireLearningAssessment && !has("TRAINING")) issues.push({ path: "completion.requireLearningAssessment", code: "TYPE_COMPLETION_NEEDS_TRAINING", message: "Avaliação de aprendizagem só existe com a capacidade Treinamento." })
  if (definition.aiDraft && !has("TRAINING") && !has("ACTION_PLAN")) issues.push({ path: "aiDraft", code: "TYPE_AI_DRAFT_UNSUPPORTED", message: "Rascunho pela IA só existe para Treinamento ou Plano de ação." })
  if (has("TRAINING") && has("RECOGNITION")) issues.push({ path: "capabilities", code: "TYPE_CAPABILITIES_INCOMPATIBLE", message: "Treinamento (lacuna de habilidade) e Reconhecimento não convivem no mesmo tipo." })

  const stepTitles = new Set<string>()
  definition.script.forEach((step, index) => {
    const path = `script.${index}`
    if (step.kind === "TASK" && !has("TASKS")) issues.push({ path: `${path}.kind`, code: "TYPE_SCRIPT_NEEDS_TASKS", message: `O passo "${step.title}" é uma tarefa: marque a capacidade Tarefas (ou Plano de ação).` })
    if (step.kind === "CHECKPOINT" && !has("CHECKPOINTS")) issues.push({ path: `${path}.kind`, code: "TYPE_SCRIPT_NEEDS_CHECKPOINTS", message: `O passo "${step.title}" é um checkpoint: marque a capacidade Checkpoints (ou Plano de ação).` })
    if (step.dueInDays !== null && step.dueInDays > definition.defaultDueDays) issues.push({ path: `${path}.dueInDays`, code: "TYPE_SCRIPT_DUE_AFTER_DEADLINE", message: `O passo "${step.title}" vence depois do prazo padrão do tipo (${definition.defaultDueDays} dias).` })
    const title = step.title.trim().toLowerCase()
    if (stepTitles.has(title)) issues.push({ path: `${path}.title`, code: "TYPE_SCRIPT_STEP_DUPLICATED", message: `O passo "${step.title}" aparece mais de uma vez no roteiro.` })
    stepTitles.add(title)
  })

  const seen = new Set<string>()
  definition.incompatibleWith.forEach((key, index) => {
    if (key === ownKey) issues.push({ path: `incompatibleWith.${index}`, code: "TYPE_INCOMPATIBLE_SELF", message: "Um tipo não pode ser incompatível consigo mesmo." })
    else if (!knownTypeKeys.has(key)) issues.push({ path: `incompatibleWith.${index}`, code: "TYPE_INCOMPATIBLE_UNKNOWN", message: `Não existe tipo de intervenção com a chave ${key}.` })
    if (seen.has(key)) issues.push({ path: `incompatibleWith.${index}`, code: "TYPE_INCOMPATIBLE_DUPLICATED", message: `A chave ${key} está repetida.` })
    seen.add(key)
  })

  issues.push(...continuityReviewIssues(definition))
  return issues
}

/**
 * Regras FIXAS da "Solicitar avaliação de continuidade" — valem para qualquer configuração e não podem ser desligadas:
 * aprovação humana obrigatória (a decisão é de quem tem `interventions.sensitive_decide`, nunca de quem pediu nem da IA),
 * evidências obrigatórias, nada de rascunho por IA e nenhuma mistura com capacidades de execução. Nenhuma decisão possível
 * altera a situação funcional: isso está no próprio vocabulário de decisões (`CONTINUITY_DECISIONS`), não na configuração.
 */
export function continuityReviewIssues(definition: InterventionTypeDefinition): ConfigIssue[] {
  if (!definition.capabilities.includes("CONTINUITY_REVIEW")) return []
  const issues: ConfigIssue[] = []
  if (definition.capabilities.length > 1) issues.push({ path: "capabilities", code: "CONTINUITY_REVIEW_EXCLUSIVE", message: "A avaliação de continuidade é um processo próprio: não se combina com outras capacidades." })
  if (!definition.approval.required) issues.push({ path: "approval", code: "CONTINUITY_REVIEW_APPROVAL_REQUIRED", message: "A avaliação de continuidade sempre exige decisão humana; não é possível desligar." })
  if (definition.evidence.minimumItems < 1) issues.push({ path: "evidence.minimumItems", code: "CONTINUITY_REVIEW_EVIDENCE_REQUIRED", message: "A avaliação de continuidade exige pelo menos uma evidência verificável." })
  if (definition.aiDraft) issues.push({ path: "aiDraft", code: "CONTINUITY_REVIEW_NO_AI", message: "A IA nunca rascunha nem decide uma avaliação de continuidade." })
  if (definition.collaboratorVisible) issues.push({ path: "collaboratorVisible", code: "CONTINUITY_REVIEW_NOT_VISIBLE", message: "A avaliação de continuidade nunca aparece para o colaborador." })
  return issues
}

export const isSensitiveType = (definition: Pick<InterventionTypeDefinition, "capabilities">) => definition.capabilities.includes("CONTINUITY_REVIEW")

/** O tipo pode ser aberto por uma regra INCONCLUSIVA? Só se TODAS as capacidades não classificam o colaborador. */
export const allowedOnInconclusive = (definition: Pick<InterventionTypeDefinition, "capabilities">) =>
  effectiveCapabilities(definition.capabilities).every((capability) => CAPABILITY_DEFINITIONS[capability].allowedOnInconclusive)

export const assertsSkillGap = (definition: Pick<InterventionTypeDefinition, "capabilities">) =>
  effectiveCapabilities(definition.capabilities).some((capability) => CAPABILITY_DEFINITIONS[capability].assertsSkillGap)

/** Um tipo novo começa assim no editor (rascunho): nada é imposto além do formato. */
export function emptyInterventionTypeDefinition(name = "Nova intervenção"): InterventionTypeDefinition {
  return {
    schemaVersion: INTERVENTION_TYPE_SCHEMA_VERSION,
    name,
    description: "",
    capabilities: ["TASKS"],
    responsibleRole: "SUPERVISOR",
    defaultDueDays: 15,
    approval: { required: false },
    evidence: { minimumItems: 1, acceptedKinds: ["EVALUATION", "FEEDBACK", "DIAGNOSIS", "INDICATOR_RESULT"] },
    form: [],
    completion: { requireAllTasksDone: true, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: true },
    incompatibleWith: [],
    aiDraft: false,
    script: [],
    collaboratorVisible: false,
  }
}

export type ScriptItem = { kind: "TASK" | "CHECKPOINT"; title: string; description: string; ownerId: string; dueAt: string }

/**
 * Os itens com que a intervenção nasce, a partir do roteiro do tipo — pura. O prazo de cada passo nunca passa do prazo da
 * intervenção (a política pode abri-la com prazo menor que o padrão do tipo).
 */
export function scriptItemsOf(definition: Pick<InterventionTypeDefinition, "script">, input: { openedDay: string; dueAt: string; responsibleId: string; personId: string }): ScriptItem[] {
  return definition.script.map((step) => {
    const stepDue = step.dueInDays === null ? input.dueAt : addCivilDays(input.openedDay, step.dueInDays)
    return { kind: step.kind, title: step.title, description: step.description, ownerId: step.owner === "COLLABORATOR" ? input.personId : input.responsibleId, dueAt: stepDue > input.dueAt ? input.dueAt : stepDue }
  })
}
