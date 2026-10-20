import { z } from "zod"
import {
  MAX_ANSWER_SOURCES,
  MAX_CLARIFICATION_OPTIONS,
  MAX_OPTION_EVIDENCE,
  MAX_QUESTION_FACTS,
  MIN_CLARIFICATION_OPTIONS,
  normalizeLabel,
  optionIdFor,
  sameSource,
  type ClarificationOption,
  type ClarificationStep,
  type KnowledgeSourceRef,
  type QuestionFact,
} from "./clarification-state.js"

/**
 * CONTRATO entre a IA e a aplicação no esclarecimento pelas bases. A IA nunca recebe ids técnicos: cada base listada ganha um
 * marcador (B1, B2…), cada seção mostrada outro (K1, K2…) e cada opção da etapa aberta outro (O1, O2…); a aplicação traduz de volta.
 * A IA NAVEGA: decide abrir bases e ler seções (READ) antes de esclarecer, responder ou dizer que falta — nenhuma busca por palavra
 * escolhe por ela. O que a IA devolve é JSON validado AQUI — a tela só renderiza componentes da aplicação a partir do resultado
 * validado, nunca HTML do modelo.
 *
 * Regras aplicadas por código (não só pedidas no prompt): toda opção cita ao menos um marcador apresentado (sem evidência = opção
 * rejeitada); rótulos idênticos (sem acento, caixa e pontuação) viram uma opção; nunca menos de 2 nem mais de 30 opções; nunca a
 * mesma dimensão (nem o mesmo conjunto de opções) de uma etapa anterior; nunca uma etapa nova depois do limite; consultas (READ)
 * limitadas por pergunta; a resposta final só cita seções (K-n).
 */
export const CLARIFICATION_PLANNER_CONTRACT = "KNOWLEDGE_CLARIFICATION_PLANNER_V1" as const
export const CLARIFICATION_ANSWER_CONTRACT = "KNOWLEDGE_CLARIFICATION_ANSWER_V1" as const

const refList = z.array(z.string().max(16)).max(60)

export const plannerOutputSchema = z.object({
  decision: z.enum(["READ", "CLARIFY", "ANSWER", "INSUFFICIENT", "NOT_APPLICABLE"]),
  /** READ: bases a abrir (B-n, sumário completo) e seções a ler (K-n, texto inteiro). */
  read: refList.nullish(),
  pendingReply: z.object({ kind: z.enum(["OPTIONS", "CONTEXT", "NEW_QUESTION"]), optionRefs: refList.nullish() }).nullish(),
  questionFacts: z.array(z.object({ dimension: z.string().max(200), value: z.string().max(400) })).max(20).nullish(),
  clarification: z
    .object({
      dimension: z.string().max(200),
      question: z.string().max(600),
      selectionMode: z.enum(["SINGLE", "MULTIPLE"]),
      options: z.array(z.object({ label: z.string().max(300), description: z.string().max(800).nullish(), group: z.string().max(200).nullish(), evidence: refList })).max(80),
    })
    .nullish(),
  answerEvidence: refList.nullish(),
  conflicts: z.array(z.object({ description: z.string().max(800), evidence: refList })).max(10).nullish(),
  insufficient: z.object({ reason: z.string().max(1_200), ask: z.string().max(600).nullish() }).nullish(),
})
export type PlannerOutput = z.infer<typeof plannerOutputSchema>

export const answerOutputSchema = z.object({
  answer: z.string().max(16_000),
  sources: refList,
  limitations: z.string().max(1_200).nullish(),
})

export type PresentedEvidence = ReadonlyMap<string, KnowledgeSourceRef>

export type PlannerIssueCode =
  | "INVALID_JSON"
  | "CONTRACT"
  | "MISSING_FIELD"
  | "STEP_LIMIT"
  | "REPEATED_DIMENSION"
  | "REPEATED_OPTIONS"
  | "NOT_ENOUGH_OPTIONS"
  | "TOO_MANY_OPTIONS"
  | "LABEL_TOO_LONG"
  | "MISSING_EVIDENCE"
  | "NOT_APPLICABLE_FORBIDDEN"
  | "PENDING_REPLY_INVALID"
  | "READ_LIMIT"
  | "READ_EMPTY"
export type PlannerIssue = { code: PlannerIssueCode; message: string }
/** Problemas de CONVERGÊNCIA: persistindo depois da correção, o fluxo encerra explicando o que falta (nunca uma resposta sem base). */
export const CONVERGENCE_ISSUES: ReadonlySet<PlannerIssueCode> = new Set(["STEP_LIMIT", "REPEATED_DIMENSION", "REPEATED_OPTIONS", "READ_LIMIT"])

/** Por consulta (READ): bases abertas e seções lidas de uma vez. */
export const MAX_READ_BASES = 6
export const MAX_READ_SECTIONS = 12

export type RejectedOption = { label: string; reason: string }

export type PlannerValidationContext = {
  /** Tudo o que pode sustentar uma opção: bases listadas (B-n, a base como um todo) e seções mostradas (K-n). */
  evidence: PresentedEvidence
  /** O que pode sustentar a RESPOSTA: só seções (K-n) — o texto delas é lido antes de redigir. */
  answerable: ReadonlySet<string>
  /** O que ainda pode ser consultado (bases não abertas, seções não lidas). null = acabaram as consultas desta pergunta. */
  readable: { bases: ReadonlyMap<string, string>; sections: ReadonlyMap<string, KnowledgeSourceRef> } | null
  /** Etapas já respondidas (inclui a aberta quando a mensagem desta vez é a resposta digitada a ela). */
  previousSteps: readonly Pick<ClarificationStep, "dimension" | "options">[]
  /** Dimensões já definidas pela pergunta — nunca perguntadas de novo. */
  knownDimensions: readonly string[]
  /** Etapa aberta respondida por TEXTO nesta mensagem: O-n → id da opção. */
  pending: { step: ClarificationStep; optionRefs: ReadonlyMap<string, string> } | null
  stepsRemaining: number
  /** NOT_APPLICABLE só quando a mensagem pode ser outro assunto (pergunta nova ou texto livre) — nunca na escolha pelo formulário. */
  allowNotApplicable: boolean
}

export type ValidatedPlan = {
  decision: PlannerOutput["decision"]
  pendingReply: { kind: "OPTIONS" | "CONTEXT" | "NEW_QUESTION"; optionIds: string[] } | null
  questionFacts: QuestionFact[]
  /** READ: o que abrir e ler antes de decidir. */
  read: { documentIds: string[]; sections: KnowledgeSourceRef[] }
  /** CLARIFY: a etapa nova (o id é dado pela posição no fluxo). */
  step: Omit<ClarificationStep, "id" | "answer"> | null
  /** ANSWER: marcadores (e fontes) das seções que sustentam a resposta — a consulta direcionada lê o texto inteiro delas. */
  answerEvidence: { ref: string; source: KnowledgeSourceRef }[]
  conflicts: { description: string; sources: KnowledgeSourceRef[] }[]
  insufficient: { reason: string; ask: string | null } | null
}

export type PlannerValidation = { ok: true; plan: ValidatedPlan; rejectedOptions: RejectedOption[] } | { ok: false; issues: PlannerIssue[]; rejectedOptions: RejectedOption[] }

/** JSON do modelo (tolera cerca de markdown e texto em volta do objeto). */
export function parseModelJson(raw: string): unknown {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  const start = stripped.indexOf("{")
  const end = stripped.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return undefined
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim()

function sourcesOf(refs: readonly string[] | null | undefined, evidence: PresentedEvidence, max: number): { valid: { ref: string; source: KnowledgeSourceRef }[]; invalid: string[] } {
  const valid: { ref: string; source: KnowledgeSourceRef }[] = []
  const invalid: string[] = []
  for (const raw of refs ?? []) {
    const ref = raw.trim().toUpperCase()
    const source = evidence.get(ref)
    if (!source) invalid.push(raw)
    else if (!valid.some((entry) => sameSource(entry.source, source)) && valid.length < max) valid.push({ ref, source })
  }
  return { valid, invalid }
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set([...left, ...right])
  if (union.size === 0) return 0
  return [...left].filter((item) => right.has(item)).length / union.size
}

export function validatePlannerOutput(raw: string, context: PlannerValidationContext): PlannerValidation {
  const json = parseModelJson(raw)
  if (json === undefined) return { ok: false, issues: [{ code: "INVALID_JSON", message: "A resposta não é um JSON válido." }], rejectedOptions: [] }
  const parsed = plannerOutputSchema.safeParse(json)
  if (!parsed.success) return { ok: false, issues: [{ code: "CONTRACT", message: `Fora do contrato: ${parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}` }], rejectedOptions: [] }
  const output = parsed.data
  const issues: PlannerIssue[] = []
  const rejectedOptions: RejectedOption[] = []

  // Resposta digitada a uma etapa aberta: a IA diz se escolheu opções (O-n), trouxe outra informação ou mudou de assunto.
  let pendingReply: ValidatedPlan["pendingReply"] = null
  if (context.pending) {
    const reply = output.pendingReply
    if (!reply || reply.kind === "CONTEXT") pendingReply = { kind: "CONTEXT", optionIds: [] }
    else if (reply.kind === "NEW_QUESTION") pendingReply = { kind: "NEW_QUESTION", optionIds: [] }
    else {
      const optionIds = [...new Set((reply.optionRefs ?? []).map((ref) => context.pending!.optionRefs.get(ref.trim().toUpperCase())).filter((id): id is string => Boolean(id)))]
      if (context.pending.step.selectionMode === "SINGLE" && optionIds.length > 1) issues.push({ code: "PENDING_REPLY_INVALID", message: "A etapa aberta aceita uma opção só; a mensagem foi interpretada como várias." })
      pendingReply = optionIds.length > 0 ? { kind: "OPTIONS", optionIds } : { kind: "CONTEXT", optionIds: [] }
    }
  }

  const answeredDimensions = new Set([...context.previousSteps.map((step) => normalizeLabel(step.dimension)), ...context.knownDimensions.map(normalizeLabel)])
  const questionFacts: QuestionFact[] = []
  for (const fact of output.questionFacts ?? []) {
    const dimension = clip(clean(fact.dimension), 60)
    const value = clip(clean(fact.value), 200)
    if (!dimension || !value) continue
    if (context.previousSteps.some((step) => normalizeLabel(step.dimension) === normalizeLabel(dimension))) continue
    if (questionFacts.some((existing) => normalizeLabel(existing.dimension) === normalizeLabel(dimension))) continue
    if (questionFacts.length < MAX_QUESTION_FACTS) questionFacts.push({ dimension, value })
  }

  if (output.decision === "NOT_APPLICABLE" && !context.allowNotApplicable) issues.push({ code: "NOT_APPLICABLE_FORBIDDEN", message: "A escolha veio do formulário desta etapa: decida CLARIFY, ANSWER ou INSUFFICIENT." })

  let step: ValidatedPlan["step"] = null
  if (output.decision === "CLARIFY") {
    const clarification = output.clarification
    if (!clarification) issues.push({ code: "MISSING_FIELD", message: "CLARIFY exige o objeto \"clarification\"." })
    else {
      const dimension = clip(clean(clarification.dimension), 60)
      const question = clip(clean(clarification.question), 240)
      if (!dimension || !question) issues.push({ code: "MISSING_FIELD", message: "A etapa precisa de \"dimension\" e \"question\"." })
      if (context.stepsRemaining <= 0) issues.push({ code: "STEP_LIMIT", message: "O limite de etapas de esclarecimento chegou: decida ANSWER (se as fontes já sustentam a resposta) ou INSUFFICIENT (explicando o que falta)." })
      const knownFact = questionFacts.some((fact) => normalizeLabel(fact.dimension) === normalizeLabel(dimension))
      if (dimension && (answeredDimensions.has(normalizeLabel(dimension)) || knownFact)) issues.push({ code: "REPEATED_DIMENSION", message: `A dimensão "${dimension}" já foi definida: não pergunte de novo — pergunte outra distinção que mude a resposta, ou responda.` })
      // Opções: evidência obrigatória; rótulos iguais (normalizados) viram uma opção só, com as evidências somadas.
      const options: ClarificationOption[] = []
      for (const candidate of clarification.options) {
        const label = clean(candidate.label)
        if (!label) continue
        if (label.length > 80) {
          issues.push({ code: "LABEL_TOO_LONG", message: `Rótulo longo demais (máx. 80): "${clip(label, 60)}" — use a descrição para o detalhe.` })
          continue
        }
        const { valid, invalid } = sourcesOf(candidate.evidence, context.evidence, MAX_OPTION_EVIDENCE)
        if (valid.length === 0) {
          rejectedOptions.push({ label, reason: invalid.length > 0 ? `cita marcadores inexistentes (${invalid.join(", ")})` : "sem evidência nas fontes consultadas" })
          continue
        }
        const id = optionIdFor(dimension || question, label)
        const existing = options.find((option) => option.id === id)
        if (existing) {
          for (const { source } of valid) if (!existing.evidence.some((item) => sameSource(item, source)) && existing.evidence.length < MAX_OPTION_EVIDENCE) existing.evidence.push(source)
          continue
        }
        options.push({ id, label, description: clean(candidate.description) ? clip(clean(candidate.description), 200) : null, group: clean(candidate.group) ? clip(clean(candidate.group), 60) : null, evidence: valid.map((entry) => entry.source) })
      }
      if (options.length < MIN_CLARIFICATION_OPTIONS) {
        const rejected = rejectedOptions.map((option) => `"${option.label}" (${option.reason})`).join(", ")
        issues.push({ code: "NOT_ENOUGH_OPTIONS", message: `Uma etapa precisa de ao menos ${MIN_CLARIFICATION_OPTIONS} opções distintas, cada uma citando os marcadores K-n que a sustentam.${rejected ? ` Rejeitadas: ${rejected}.` : ""} Se só um cenário se sustenta nas fontes, não pergunte: decida ANSWER.` })
      }
      if (options.length > MAX_CLARIFICATION_OPTIONS) issues.push({ code: "TOO_MANY_OPTIONS", message: `${options.length} opções é demais para uma etapa (máx. ${MAX_CLARIFICATION_OPTIONS}): pergunte primeiro uma distinção mais ampla que separe os cenários em grupos.` })
      const labels = new Set(options.map((option) => normalizeLabel(option.label)))
      if (context.previousSteps.some((previous) => overlap(labels, new Set(previous.options.map((option) => normalizeLabel(option.label)))) >= 0.8)) issues.push({ code: "REPEATED_OPTIONS", message: "Estas opções repetem as de uma etapa anterior: não pergunte de novo." })
      step = { dimension, question, selectionMode: clarification.selectionMode, options }
    }
  }

  const read: ValidatedPlan["read"] = { documentIds: [], sections: [] }
  if (output.decision === "READ") {
    if (!context.readable) issues.push({ code: "READ_LIMIT", message: "Não há mais consultas para esta pergunta: decida CLARIFY, ANSWER ou INSUFFICIENT com o que já foi mostrado." })
    else {
      for (const raw of output.read ?? []) {
        const ref = raw.trim().toUpperCase()
        const documentId = context.readable.bases.get(ref)
        if (documentId && !read.documentIds.includes(documentId) && read.documentIds.length < MAX_READ_BASES) read.documentIds.push(documentId)
        const section = context.readable.sections.get(ref)
        if (section && !read.sections.some((item) => sameSource(item, section)) && read.sections.length < MAX_READ_SECTIONS) read.sections.push(section)
      }
      if (read.documentIds.length === 0 && read.sections.length === 0) issues.push({ code: "READ_EMPTY", message: "READ precisa de bases ainda não abertas (B-n) ou seções ainda não lidas (K-n) que aparecem acima; se já tem o suficiente, decida." })
    }
  }

  let answerEvidence: ValidatedPlan["answerEvidence"] = []
  if (output.decision === "ANSWER") {
    answerEvidence = sourcesOf((output.answerEvidence ?? []).filter((ref) => context.answerable.has(ref.trim().toUpperCase())), context.evidence, MAX_ANSWER_SOURCES).valid
    if (answerEvidence.length === 0) issues.push({ code: "MISSING_EVIDENCE", message: "ANSWER exige \"answerEvidence\" com os marcadores K-n das SEÇÕES que sustentam a resposta (base inteira, B-n, não vale: abra a base e cite as seções)." })
  }

  let insufficient: ValidatedPlan["insufficient"] = null
  if (output.decision === "INSUFFICIENT") {
    const reason = clip(clean(output.insufficient?.reason), 400)
    if (!reason) issues.push({ code: "MISSING_FIELD", message: "INSUFFICIENT exige \"insufficient.reason\" dizendo o que as fontes não cobrem." })
    insufficient = { reason, ask: clean(output.insufficient?.ask) ? clip(clean(output.insufficient?.ask), 200) : null }
  }

  const conflicts = (output.conflicts ?? []).flatMap((conflict) => {
    const description = clip(clean(conflict.description), 300)
    const sources = sourcesOf(conflict.evidence, context.evidence, 6).valid.map((entry) => entry.source)
    return description && sources.length > 0 ? [{ description, sources }] : []
  }).slice(0, 5)

  if (issues.length > 0) return { ok: false, issues, rejectedOptions }
  return { ok: true, plan: { decision: output.decision, pendingReply, questionFacts, read, step, answerEvidence, conflicts, insufficient }, rejectedOptions }
}

export type AnswerValidation = { ok: true; text: string; sources: KnowledgeSourceRef[]; limitations: string | null } | { ok: false; issues: string[] }

const INLINE_REFS = /\[\s*(K\d+(?:\s*[,;]\s*K\d+)*)\s*\]/gi

/**
 * Resposta final: os marcadores citados no texto ([K3] ou [K3, K5]) viram [1], [2]… na ordem em que aparecem, e a lista de fontes
 * segue essa numeração. Marcador fora das seções lidas = resposta inválida (nunca uma fonte inventada na tela).
 */
export function validateAnswerOutput(raw: string, evidence: PresentedEvidence): AnswerValidation {
  const json = parseModelJson(raw)
  if (json === undefined) return { ok: false, issues: ["A resposta não é um JSON válido."] }
  const parsed = answerOutputSchema.safeParse(json)
  if (!parsed.success) return { ok: false, issues: [`Fora do contrato: ${parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`] }
  const output = parsed.data
  const issues: string[] = []
  const order: string[] = []
  const register = (ref: string) => {
    const normalized = ref.trim().toUpperCase()
    if (!evidence.has(normalized)) {
      issues.push(`O marcador ${normalized} não está entre as seções lidas.`)
      return null
    }
    if (!order.includes(normalized)) order.push(normalized)
    return order.indexOf(normalized) + 1
  }
  const text = output.answer.replace(INLINE_REFS, (_match, group: string) => group.split(/[,;]/).map((ref) => register(ref)).filter((n): n is number => n !== null).map((n) => `[${n}]`).join("")).trim()
  for (const ref of output.sources) register(ref)
  if (!text) issues.push("A resposta está vazia.")
  if (order.length === 0) issues.push("A resposta precisa citar ao menos uma seção lida (K-n).")
  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)] }
  const sources = order.slice(0, MAX_ANSWER_SOURCES).map((ref) => evidence.get(ref)!)
  return { ok: true, text, sources, limitations: clean(output.limitations) ? clip(clean(output.limitations), 400) : null }
}
