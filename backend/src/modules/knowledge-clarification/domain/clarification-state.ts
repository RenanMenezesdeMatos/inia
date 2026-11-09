import { createHash } from "node:crypto"
import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * ESCLARECIMENTO PELAS BASES — o estado de UM fluxo de esclarecimento de uma pergunta (a pergunta original, as etapas já feitas
 * com as opções e as escolhas, o que a pergunta já informava, a cobertura da busca e, ao responder, as fontes). Fica gravado
 * junto de cada resposta da INIA (`assistant_interactions.tool_calls`, entrada `knowledge_clarification`): a conversa é o
 * histórico do fluxo e a fonte da verdade — o navegador só diz qual etapa respondeu, e o servidor sempre relê o estado do banco.
 *
 * Nada aqui conhece produto, público, modalidade ou procedimento: dimensões, perguntas e opções vêm do conteúdo das bases e são
 * só DADOS. O código conhece o contrato — ids estáveis, evidência obrigatória por opção, limites contra ciclos.
 */
export const KNOWLEDGE_CLARIFICATION_VERSION = "KNOWLEDGE_CLARIFICATION_V1" as const
/** Entrada em `tool_calls` da resposta da INIA com o estado do fluxo. */
export const CLARIFICATION_TOOL_NAME = "knowledge_clarification" as const
/** Entrada em `tool_calls` da mensagem de quem pergunta quando ela responde (ou corrige) uma etapa pelo formulário. */
export const CLARIFICATION_ANSWER_TOOL_NAME = "knowledge_clarification_answer" as const

/** Etapas respondidas antes de a INIA ter de decidir (responder ou dizer o que falta) — proteção contra ciclos e excesso de etapas. */
export const MAX_CLARIFICATION_STEPS = 4
export const MIN_CLARIFICATION_OPTIONS = 2
/** Acima disso a pergunta precisa ser mais ampla primeiro (nunca cortar cenários em silêncio). */
export const MAX_CLARIFICATION_OPTIONS = 30
export const MAX_OPTION_EVIDENCE = 6
export const MAX_ANSWER_SOURCES = 12
export const MAX_SOURCE_IMAGES = 24
export const MAX_QUESTION_FACTS = 6

const OPTION_ID = /^opt_[a-f0-9]{10}$/
const STEP_ID = /^step_\d{1,2}_[a-f0-9]{8}$/

/** Uma fonte citável: base + versão publicada + seção (posição do trecho). Nunca o texto. */
export const knowledgeSourceRefSchema = z.object({
  documentId: z.string().min(1).max(64),
  documentTitle: z.string().max(300),
  versionId: z.string().max(64),
  heading: z.string().max(300),
  chunkIndex: z.number().int().min(0),
  /** Páginas do PDF de origem. Vêm do registro da conversão, nunca da IA; estado gravado antes disso não tem. */
  pages: z.object({ from: z.number().int().min(1), to: z.number().int().min(1) }).optional(),
  /** Imagens da seção no arquivo, só nas fontes de uma resposta e só para a tela: vêm do registro da conversão e a IA não as recebe. */
  images: z.array(z.object({ id: z.string().max(64), page: z.number().int().min(1), width: z.number().int().min(1), height: z.number().int().min(1) })).max(MAX_SOURCE_IMAGES).optional(),
})
export type KnowledgeSourceRef = z.infer<typeof knowledgeSourceRefSchema>

export const clarificationOptionSchema = z.object({
  id: z.string().regex(OPTION_ID),
  label: z.string().min(1).max(80),
  description: z.string().max(200).nullable(),
  /** Agrupamento fundamentado nas fontes, só quando há muitas opções. */
  group: z.string().max(60).nullable(),
  evidence: z.array(knowledgeSourceRefSchema).min(1).max(MAX_OPTION_EVIDENCE),
})
export type ClarificationOption = z.infer<typeof clarificationOptionSchema>

export const stepAnswerSchema = z.object({
  optionIds: z.array(z.string().regex(OPTION_ID)).max(MAX_CLARIFICATION_OPTIONS),
  freeText: z.string().max(1_000).nullable(),
  noneMatched: z.boolean(),
  /** FORM = escolhida no formulário; TEXT = interpretada de uma mensagem digitada. */
  via: z.enum(["FORM", "TEXT"]),
  answeredAt: z.string(),
})
export type StepAnswer = z.infer<typeof stepAnswerSchema>

export const clarificationStepSchema = z.object({
  id: z.string().regex(STEP_ID),
  dimension: z.string().min(1).max(60),
  question: z.string().min(1).max(240),
  selectionMode: z.enum(["SINGLE", "MULTIPLE"]),
  options: z.array(clarificationOptionSchema).min(MIN_CLARIFICATION_OPTIONS).max(MAX_CLARIFICATION_OPTIONS),
  answer: stepAnswerSchema.nullable(),
})
export type ClarificationStep = z.infer<typeof clarificationStepSchema>

/** O que a própria pergunta (ou a conversa) já informava — nunca perguntado de novo. */
export const questionFactSchema = z.object({ dimension: z.string().min(1).max(60), value: z.string().min(1).max(200) })
export type QuestionFact = z.infer<typeof questionFactSchema>

export const clarificationCoverageSchema = z.object({
  consideredDocuments: z.number().int().min(0),
  matchedDocuments: z.number().int().min(0),
  presentedDocuments: z.number().int().min(0),
  omittedDocuments: z.number().int().min(0),
  /** false = a busca deixou bases ou seções de fora pelo orçamento: a tela nunca diz "todas as possibilidades". */
  complete: z.boolean(),
})
export type ClarificationCoverage = z.infer<typeof clarificationCoverageSchema>

export const clarificationConflictSchema = z.object({ description: z.string().min(1).max(300), sources: z.array(knowledgeSourceRefSchema).min(1).max(6) })

export const clarificationStatusSchema = z.enum(["OPEN", "ANSWERED", "INSUFFICIENT", "NOT_CONVERGED"])
export type ClarificationStatus = z.infer<typeof clarificationStatusSchema>

export const clarificationStateSchema = z.object({
  version: z.literal(KNOWLEDGE_CLARIFICATION_VERSION),
  id: z.string().uuid(),
  originalQuestion: z.string().min(1).max(8_000),
  /** OPEN = há uma etapa aguardando escolha; ANSWERED = respondida com fontes; INSUFFICIENT = as bases não sustentam; NOT_CONVERGED
   * = o limite de etapas chegou sem cenário definido (a INIA explica o que falta, sem resposta específica). */
  status: clarificationStatusSchema,
  steps: z.array(clarificationStepSchema).max(MAX_CLARIFICATION_STEPS + 1),
  questionFacts: z.array(questionFactSchema).max(MAX_QUESTION_FACTS),
  coverage: clarificationCoverageSchema,
  /** Fontes da resposta (só ANSWERED), na ordem dos marcadores [n] do texto. */
  sources: z.array(knowledgeSourceRefSchema).max(MAX_ANSWER_SOURCES),
  conflicts: z.array(clarificationConflictSchema).max(5),
  /** Motivo de INSUFFICIENT / NOT_CONVERGED, ou a limitação declarada na resposta. */
  notice: z.string().max(600).nullable(),
  updatedAt: z.string(),
})
export type ClarificationState = z.infer<typeof clarificationStateSchema>

/** Resposta (ou correção) de uma etapa enviada pelo formulário do chat — o servidor valida contra o estado gravado. */
export const clarificationAnswerRequestSchema = z.object({
  clarificationId: z.string().uuid(),
  stepId: z.string().regex(STEP_ID),
  optionIds: z.array(z.string().regex(OPTION_ID)).max(MAX_CLARIFICATION_OPTIONS).default([]),
  freeText: z.string().trim().max(1_000).optional(),
  noneMatched: z.boolean().default(false),
  /** Corrigir uma etapa já respondida: as etapas seguintes são refeitas a partir dela. */
  revise: z.boolean().default(false),
})
export type ClarificationAnswerRequest = z.infer<typeof clarificationAnswerRequestSchema>

/** Lê um estado gravado (defensivo: dado do banco de outra versão ou corrompido = null, nunca erro na tela). */
export function parseClarificationState(value: unknown): ClarificationState | null {
  const parsed = clarificationStateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** O estado gravado numa entrada de `tool_calls` (null = a mensagem não é do fluxo de esclarecimento). */
export function clarificationStateOfToolCalls(toolCalls: unknown): ClarificationState | null {
  if (!Array.isArray(toolCalls)) return null
  for (const call of toolCalls) {
    if (call && typeof call === "object" && "toolName" in call && call.toolName === CLARIFICATION_TOOL_NAME && "state" in call) return parseClarificationState(call.state)
  }
  return null
}

export function normalizeLabel(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function shortHash(text: string, length: number): string {
  return createHash("sha1").update(text).digest("hex").slice(0, length)
}

/** Id da etapa: posição + dimensão normalizada — o mesmo para a mesma dimensão na mesma posição. */
export function stepIdFor(position: number, dimension: string): string {
  return `step_${Math.min(99, Math.max(1, position))}_${shortHash(normalizeLabel(dimension), 8)}`
}

/** Id da opção: dimensão + rótulo normalizados — estável entre execuções; sinônimos exatos colapsam no mesmo id. */
export function optionIdFor(dimension: string, label: string): string {
  return `opt_${shortHash(`${normalizeLabel(dimension)}|${normalizeLabel(label)}`, 10)}`
}

export function answeredStepsOf(state: ClarificationState): ClarificationStep[] {
  return state.steps.filter((step) => step.answer !== null)
}

/** A etapa aguardando escolha (a última, sem resposta, com o fluxo aberto). */
export function openStepOf(state: ClarificationState): ClarificationStep | null {
  const last = state.steps.at(-1)
  return state.status === "OPEN" && last && last.answer === null ? last : null
}

export function sameSource(left: Pick<KnowledgeSourceRef, "documentId" | "chunkIndex">, right: Pick<KnowledgeSourceRef, "documentId" | "chunkIndex">): boolean {
  return left.documentId === right.documentId && left.chunkIndex === right.chunkIndex
}

/** Bases que sustentam as escolhas feitas — o FOCO da próxima busca (a busca continua olhando as demais). */
export function focusDocumentIdsOf(state: ClarificationState): string[] {
  const ids: string[] = []
  for (const step of answeredStepsOf(state)) {
    for (const option of step.options) {
      if (!step.answer!.optionIds.includes(option.id)) continue
      for (const source of option.evidence) if (!ids.includes(source.documentId)) ids.push(source.documentId)
    }
  }
  return ids
}

export type ScenarioFact = { dimension: string; value: string; origin: "QUESTION" | "SELECTION" | "TEXT"; stepId: string | null }

/** Cenário acumulado: o que a pergunta informava + cada escolha (e o complemento digitado), na ordem das etapas. */
export function scenarioOf(state: ClarificationState): ScenarioFact[] {
  const facts: ScenarioFact[] = state.questionFacts.map((fact) => ({ ...fact, origin: "QUESTION" as const, stepId: null }))
  for (const step of answeredStepsOf(state)) {
    const answer = step.answer!
    const labels = step.options.filter((option) => answer.optionIds.includes(option.id)).map((option) => option.label)
    if (labels.length > 0) facts.push({ dimension: step.dimension, value: labels.join(" + "), origin: "SELECTION", stepId: step.id })
    else if (answer.noneMatched) facts.push({ dimension: step.dimension, value: "nenhuma das opções apresentadas", origin: "SELECTION", stepId: step.id })
    if (answer.freeText) facts.push({ dimension: labels.length > 0 || answer.noneMatched ? `${step.dimension} (complemento)` : step.dimension, value: answer.freeText, origin: "TEXT", stepId: step.id })
  }
  return facts
}

export function describeScenario(state: ClarificationState): string {
  return scenarioOf(state).map((fact) => `${fact.dimension}: ${fact.value}`).join(" · ")
}

/** Texto legível da escolha (a mensagem de quem pergunta gravada na conversa). */
export function describeStepAnswer(step: ClarificationStep, answer: Pick<StepAnswer, "optionIds" | "freeText" | "noneMatched">): string {
  const labels = step.options.filter((option) => answer.optionIds.includes(option.id)).map((option) => option.label)
  const chosen = answer.noneMatched ? "Nenhuma das opções corresponde ao meu caso" : labels.join("; ")
  return [chosen, answer.freeText].filter(Boolean).join(" — ")
}

/** Conteúdo gravado da mensagem de esclarecimento: a pergunta + as opções numa linha (histórico, monitoramento e contexto do modelo). */
export function renderClarificationContent(step: Pick<ClarificationStep, "question" | "options">): string {
  return `${step.question}\n\nOpções encontradas nas bases consultadas: ${step.options.map((option) => option.label).join(" · ")}.`
}

function invalidAnswer(message: string): DomainError {
  return new DomainError(message, "KNOWLEDGE_CLARIFICATION_ANSWER_INVALID", 422)
}

/**
 * Aplica a resposta (ou a correção) de uma etapa ao estado gravado. Responder = só a etapa aberta. Corrigir = qualquer etapa já
 * respondida (ou a aberta): as etapas seguintes saem — elas dependiam da escolha anterior — e o fluxo volta a ficar aberto.
 */
export function applyStepAnswer(state: ClarificationState, request: Pick<ClarificationAnswerRequest, "stepId" | "optionIds" | "freeText" | "noneMatched" | "revise">, via: StepAnswer["via"], now: Date): ClarificationState {
  const position = state.steps.findIndex((step) => step.id === request.stepId)
  if (position === -1) throw invalidAnswer("Esta etapa do esclarecimento não existe mais. Faça a pergunta de novo.")
  const step = state.steps[position]!
  const open = openStepOf(state)
  if (!request.revise && open?.id !== step.id) throw invalidAnswer("Esta etapa já foi respondida. Use \"Alterar\" para corrigir a escolha.")
  const optionIds = [...new Set(request.optionIds)]
  const unknown = optionIds.filter((id) => !step.options.some((option) => option.id === id))
  if (unknown.length > 0) throw invalidAnswer("A opção escolhida não faz parte desta etapa.")
  if (step.selectionMode === "SINGLE" && optionIds.length > 1) throw invalidAnswer("Esta etapa aceita uma opção só.")
  if (request.noneMatched && optionIds.length > 0) throw invalidAnswer("Escolha uma opção ou indique que nenhuma corresponde — não os dois.")
  const freeText = request.freeText?.trim() || null
  if (optionIds.length === 0 && !freeText && !request.noneMatched) throw invalidAnswer("Escolha uma opção ou descreva o seu caso.")
  if (request.noneMatched && !freeText) throw invalidAnswer("Descreva o seu caso quando nenhuma opção corresponder.")
  const answer: StepAnswer = { optionIds, freeText, noneMatched: request.noneMatched, via, answeredAt: now.toISOString() }
  return {
    ...state,
    status: "OPEN",
    steps: [...state.steps.slice(0, position), { ...step, answer }],
    sources: [],
    conflicts: [],
    notice: null,
    updatedAt: now.toISOString(),
  }
}
