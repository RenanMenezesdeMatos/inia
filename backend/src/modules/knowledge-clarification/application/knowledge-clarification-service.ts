import { randomUUID } from "node:crypto"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AiCallCancelledError } from "../../../shared/application/model-routing/ai-errors.js"
import { currentAiAbortSignal } from "../../../shared/application/model-routing/ai-runtime.js"
import type { ReadableKnowledge, ReadableKnowledgeRequest } from "../../knowledge/application/knowledge-catalog.js"
import { CONVERGENCE_ISSUES, validateAnswerOutput, validatePlannerOutput, type PlannerIssue, type PlannerValidation, type PlannerValidationContext, type RejectedOption, type ValidatedPlan } from "../domain/clarification-contract.js"
import { ANSWER_SYSTEM, renderAnswerInput, renderCorrection, renderPlannerInput, renderPlannerSystem, type AnswerSection, type PlannerInput } from "../domain/clarification-prompts.js"
import {
  KNOWLEDGE_CLARIFICATION_VERSION,
  MAX_CLARIFICATION_STEPS,
  MAX_QUESTION_FACTS,
  answeredStepsOf,
  applyStepAnswer,
  describeScenario,
  normalizeLabel,
  openStepOf,
  renderClarificationContent,
  stepIdFor,
  type ClarificationAnswerRequest,
  type ClarificationState,
  type ClarificationStep,
  type QuestionFact,
} from "../domain/clarification-state.js"
import { DEFAULT_NAVIGATION_BUDGET, KnowledgeWorkspace, type NavigationBudget } from "../domain/knowledge-workspace.js"
import type { ClarificationModel } from "./clarification-model.js"

/**
 * ESCLARECIMENTO DINÂMICO PELAS BASES (chat de texto de quem atende). Antes da orquestração de sempre, a IA NAVEGA pelas bases que
 * a pessoa pode consultar (as dos especialistas do Orquestrador dela): vê a lista das bases com o começo do sumário de cada uma,
 * abre as que fazem sentido, lê as seções que quiser (READ, poucas rodadas) e decide, com saída validada por código:
 *   - CLARIFY → uma pergunta curta com opções fundamentadas nas bases (formulário no chat);
 *   - ANSWER → leitura das seções aplicáveis e resposta citando cada uma ([n] → fontes visíveis);
 *   - INSUFFICIENT → as bases não sustentam: diz o que falta e pede uma informação objetiva (ou reformular);
 *   - NOT_APPLICABLE → não é pergunta de procedimento/conteúdo das bases: segue o caminho de sempre (PASS).
 * Nenhuma busca por palavra decide nada: o código só mostra a estrutura das bases e lê o que a IA pede pelo marcador. A cada escolha
 * as bases e seções que sustentaram as escolhas já começam abertas/lidas, e a IA pode consultar outras.
 *
 * Falhas nunca quebram o chat nem perdem o contexto: numa pergunta NOVA, qualquer falha (bases, IA, contrato) devolve PASS e o
 * caminho de sempre responde; ao CONTINUAR um esclarecimento (escolha pelo formulário), a falha vira erro explícito e o estado
 * gravado continua o mesmo — a escolha pode ser reenviada.
 */
export type KnowledgeClarificationDeps = {
  /** Bases autorizadas aos especialistas E legíveis por quem pergunta + glossário (`knowledge-catalog.ts`). */
  knowledge: (request: ReadableKnowledgeRequest) => Promise<ReadableKnowledge>
  model: ClarificationModel
  /** Limites de atuação dos Agents envolvidos + assuntos proibidos (texto anexado aos prompts). */
  guardrails: (organizationId: string, agentIds: readonly string[]) => Promise<string>
  /** Instruções da operação nos especialistas donos das fontes da resposta. */
  specialistInstructions: (organizationId: string, agentIds: readonly string[]) => Promise<string>
  now?: () => Date
  newId?: () => string
  budget?: NavigationBudget
}

export type ClarificationRequest = {
  organizationId: string
  personId: string
  /** Agents cujas bases autorizadas podem ser consultadas: o do Orquestrador do chat de quem pergunta e os especialistas dele. */
  orchestratorAgentId: string | null
  specialistAgentIds: readonly string[]
  /** A mensagem de quem pergunta (na escolha pelo formulário, o texto legível da escolha). */
  text: string
  /** Escolha (ou correção) enviada pelo formulário. */
  answer: ClarificationAnswerRequest | null
  /** O estado mais recente do esclarecimento nesta conversa (lido do banco) e se é a última resposta da INIA. */
  previous: { state: ClarificationState; isLatestAssistantMessage: boolean } | null
  /** Turnos anteriores da conversa (só para referências como "isso"). */
  recentTurns: readonly { role: "user" | "model"; text: string }[]
}

export type ClarificationMode = "NEW" | "ANSWER" | "REVISE" | "PENDING_TEXT"
export type ClarificationPassReason = "NO_AGENTS" | "NO_KNOWLEDGE" | "NOT_APPLICABLE" | "KNOWLEDGE_UNAVAILABLE" | "PLANNER_FAILED" | "ANSWER_FAILED"

/** Consultas (READ) por mensagem: abrir bases / ler seções antes de decidir. */
export const MAX_READ_ROUNDS = 2

/** Rastro auditável (gravado com a resposta; nunca prompt nem texto das bases). */
export type ClarificationTrace = {
  version: typeof KNOWLEDGE_CLARIFICATION_VERSION
  mode: ClarificationMode
  decision: ValidatedPlan["decision"] | "NOT_CONVERGED" | null
  /** O que a IA viu e consultou: bases listadas, abertas (títulos), seções lidas, rodadas de consulta. */
  navigation: { listed: number; opened: string[]; read: number; skippedReads: number; readRounds: number; excludedByAccess: number } | null
  rejectedOptions: RejectedOption[]
  plannerAttempts: number
  answerAttempts: number
  issues: string[]
}

export type ClarificationOutcome =
  | { kind: "PASS"; reason: ClarificationPassReason; trace: ClarificationTrace }
  | { kind: "REPLY"; content: string; state: ClarificationState; trace: ClarificationTrace }

export const CLARIFICATION_UNAVAILABLE_MESSAGE = "Não consegui continuar o esclarecimento agora. Sua escolha ficou registrada — envie de novo em instantes."

type Conversation = Omit<PlannerInput, "stepsRemaining" | "readsRemaining" | "recentTurns" | "details">
type Navigation = { workspace: KnowledgeWorkspace; knowledge: ReadableKnowledge }

export function createKnowledgeClarification(deps: KnowledgeClarificationDeps) {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? randomUUID
  const budget = deps.budget ?? DEFAULT_NAVIGATION_BUDGET

  const unavailable = () => new DomainError(CLARIFICATION_UNAVAILABLE_MESSAGE, "KNOWLEDGE_CLARIFICATION_UNAVAILABLE", 503)
  /** Cancelamento (quem perguntou foi embora) nunca vira PASS nem resposta: sobe como está. */
  const rethrowIfCancelled = (error: unknown) => {
    if (error instanceof AiCallCancelledError || currentAiAbortSignal()?.aborted) throw error
  }

  return {
    async handle(request: ClarificationRequest): Promise<ClarificationOutcome> {
      const agentIds = [...new Set([request.orchestratorAgentId, ...request.specialistAgentIds].filter((id): id is string => Boolean(id)))]
      if (request.answer) {
        const previous = request.previous?.state
        if (!previous || previous.id !== request.answer.clarificationId) throw new DomainError("Este esclarecimento foi substituído por uma pergunta mais recente. Faça a pergunta de novo.", "KNOWLEDGE_CLARIFICATION_STALE", 409)
        const state = applyStepAnswer(previous, request.answer, "FORM", now())
        return continueFlow(request, agentIds, request.answer.revise ? "REVISE" : "ANSWER", state, null)
      }
      const previous = request.previous
      if (previous && previous.isLatestAssistantMessage && openStepOf(previous.state)) return continueFlow(request, agentIds, "PENDING_TEXT", previous.state, request.text)
      return newFlow(request, agentIds, request.text, previous?.isLatestAssistantMessage ? previous.state : null)
    },
  }

  function trace(mode: ClarificationMode): ClarificationTrace {
    return { version: KNOWLEDGE_CLARIFICATION_VERSION, mode, decision: null, navigation: null, rejectedOptions: [], plannerAttempts: 0, answerAttempts: 0, issues: [] }
  }

  async function loadNavigation(request: ClarificationRequest, agentIds: string[], record: ClarificationTrace): Promise<Navigation> {
    const knowledge = await deps.knowledge({ organizationId: request.organizationId, viewerPersonId: request.personId, agentIds })
    const workspace = new KnowledgeWorkspace([...knowledge.sources.values()], budget)
    record.navigation = { ...workspace.trace(), readRounds: 0, excludedByAccess: knowledge.excludedByAccess }
    return { workspace, knowledge }
  }

  /** Pergunta NOVA (ou uma continuação da anterior pela conversa): qualquer falha = PASS, a orquestração de sempre responde. */
  async function newFlow(request: ClarificationRequest, agentIds: string[], text: string, followUpOf: ClarificationState | null): Promise<ClarificationOutcome> {
    const record = trace("NEW")
    if (agentIds.length === 0) return { kind: "PASS", reason: "NO_AGENTS", trace: record }
    let navigation: Navigation
    try {
      navigation = await loadNavigation(request, agentIds, record)
    } catch (error) {
      rethrowIfCancelled(error)
      logFailure("knowledge", error)
      return { kind: "PASS", reason: "KNOWLEDGE_UNAVAILABLE", trace: record }
    }
    if (navigation.knowledge.sources.size === 0) return { kind: "PASS", reason: "NO_KNOWLEDGE", trace: record }
    // Continuação ("e se for…?"): a pergunta anterior e o cenário dela vão como contexto; as bases que a sustentaram começam abertas.
    if (followUpOf) navigation.workspace.open([...new Set([...followUpOf.sources, ...followUpOf.steps.flatMap((step) => step.options.flatMap((option) => option.evidence))].map((source) => source.documentId))])
    const validation = await navigate(request, record, navigation, { originalQuestion: text, state: null, previous: followUpOf, pending: null }, { previousSteps: [], knownDimensions: [], pending: null, stepsRemaining: MAX_CLARIFICATION_STEPS, allowNotApplicable: true })
    if (!validation || !validation.ok) return { kind: "PASS", reason: "PLANNER_FAILED", trace: record }
    if (validation.plan.decision === "NOT_APPLICABLE") return { kind: "PASS", reason: "NOT_APPLICABLE", trace: record }
    const at = now().toISOString()
    const state: ClarificationState = { version: KNOWLEDGE_CLARIFICATION_VERSION, id: newId(), originalQuestion: text.slice(0, 8_000), status: "OPEN", steps: [], questionFacts: validation.plan.questionFacts, coverage: navigation.workspace.coverage(), sources: [], conflicts: [], notice: null, updatedAt: at }
    return (await conclude(request, record, state, validation.plan, navigation)) ?? { kind: "PASS", reason: "ANSWER_FAILED", trace: record }
  }

  /** Escolha pelo formulário, correção ou mensagem digitada com uma etapa aberta: a navegação recomeça com o cenário acumulado. */
  async function continueFlow(request: ClarificationRequest, agentIds: string[], mode: Exclude<ClarificationMode, "NEW">, state: ClarificationState, message: string | null): Promise<ClarificationOutcome> {
    const record = trace(mode)
    // Mensagem digitada com uma etapa aberta pode ser outro assunto: falha = PASS (o caminho de sempre responde; a etapa continua
    // aberta no formulário). Escolha/correção pelo formulário: falha = erro explícito, nada gravado, a escolha pode ser reenviada.
    const soft = mode === "PENDING_TEXT"
    const fail = (reason: ClarificationPassReason): ClarificationOutcome => {
      if (soft) return { kind: "PASS", reason, trace: record }
      throw unavailable()
    }
    if (agentIds.length === 0) return fail("NO_AGENTS")
    const pendingStep = mode === "PENDING_TEXT" ? openStepOf(state) : null
    const answered = answeredStepsOf(state)
    const previousSteps: ClarificationStep[] = pendingStep ? [...answered, pendingStep] : answered
    let navigation: Navigation
    try {
      navigation = await loadNavigation(request, agentIds, record)
    } catch (error) {
      rethrowIfCancelled(error)
      logFailure("knowledge", error)
      return fail("KNOWLEDGE_UNAVAILABLE")
    }
    if (navigation.knowledge.sources.size === 0) {
      // As bases que sustentavam o esclarecimento saíram do alcance (despublicadas, removidas ou fora do acesso).
      record.decision = "INSUFFICIENT"
      const notice = "As bases que sustentavam este esclarecimento não estão mais disponíveis para consulta."
      return { kind: "REPLY", content: `${notice} Se a dúvida continuar, reformule a pergunta ou procure a sua liderança imediata.`, state: { ...state, status: "INSUFFICIENT", coverage: navigation.workspace.coverage(), notice, updatedAt: now().toISOString() }, trace: record }
    }
    // O que sustentou as escolhas já começa aberto e lido (citado pela própria IA nas etapas anteriores); a etapa em aberto, aberta.
    const chosen = answered.flatMap((step) => step.options.filter((option) => step.answer!.optionIds.includes(option.id)).flatMap((option) => option.evidence))
    navigation.workspace.open([...new Set([...chosen, ...(pendingStep?.options.flatMap((option) => option.evidence) ?? [])].map((source) => source.documentId))])
    navigation.workspace.read(chosen.filter((source) => source.heading !== source.documentTitle))
    const optionRefs = new Map((pendingStep?.options ?? []).map((option, index) => [`O${index + 1}`, option.id]))
    const validation = await navigate(
      request,
      record,
      navigation,
      { originalQuestion: state.originalQuestion, state, previous: null, pending: pendingStep ? { step: pendingStep, optionRefs, message: message ?? "" } : null },
      { previousSteps, knownDimensions: state.questionFacts.map((fact) => fact.dimension), pending: pendingStep ? { step: pendingStep, optionRefs } : null, stepsRemaining: MAX_CLARIFICATION_STEPS - previousSteps.length, allowNotApplicable: mode === "PENDING_TEXT" },
    )
    if (!validation) return fail("PLANNER_FAILED")
    let current = state
    if (!validation.ok) {
      // Mesmo depois da correção a IA insiste em perguntar além do limite, repetir uma etapa ou consultar além do limite: o fluxo
      // não converge — encerra explicando o que falta (nunca uma resposta sem base nem mais uma volta).
      if (validation.issues.some((issue) => CONVERGENCE_ISSUES.has(issue.code))) {
        if (pendingStep && message) current = applyStepAnswer(current, { stepId: pendingStep.id, optionIds: [], freeText: message.slice(0, 1_000), noneMatched: false, revise: false }, "TEXT", now())
        return notConverged(current, navigation, record, validation.issues)
      }
      return fail("PLANNER_FAILED")
    }
    const result = validation.plan
    if (pendingStep) {
      const reply = result.pendingReply ?? { kind: "CONTEXT" as const, optionIds: [] }
      // Outro assunto: o esclarecimento em aberto fica como está (o formulário continua disponível). Fora das bases = o caminho de
      // sempre; outra pergunta sobre as bases = um esclarecimento novo para ela.
      if (result.decision === "NOT_APPLICABLE") return { kind: "PASS", reason: "NOT_APPLICABLE", trace: record }
      if (reply.kind === "NEW_QUESTION") return newFlow(request, agentIds, message ?? request.text, null)
      current = applyStepAnswer(current, { stepId: pendingStep.id, optionIds: reply.optionIds, freeText: reply.kind === "CONTEXT" ? (message ?? "").slice(0, 1_000) : undefined, noneMatched: false, revise: false }, "TEXT", now())
    }
    current = { ...current, questionFacts: mergeFacts(current.questionFacts, result.questionFacts, current.steps) }
    return (await conclude(request, record, current, result, navigation)) ?? fail("ANSWER_FAILED")
  }

  /** Rodadas de navegação: a IA consulta (READ) até MAX_READ_ROUNDS vezes e então decide. null = a IA falhou (transporte/provedor). */
  async function navigate(request: ClarificationRequest, record: ClarificationTrace, navigation: Navigation, conversation: Conversation, context: Omit<PlannerValidationContext, "evidence" | "answerable" | "readable">): Promise<PlannerValidation | null> {
    const { workspace, knowledge } = navigation
    let guardrails = ""
    try {
      guardrails = await deps.guardrails(request.organizationId, request.orchestratorAgentId ? [request.orchestratorAgentId] : [])
    } catch (error) {
      logFailure("guardrails", error)
      return null
    }
    for (let reads = 0; ; reads += 1) {
      const view = workspace.render()
      const readsRemaining = MAX_READ_ROUNDS - reads
      const system = renderPlannerSystem({ guardrails, glossary: knowledge.glossary, coverage: workspace.coverage(), catalog: view.catalog })
      const user = renderPlannerInput({ ...conversation, stepsRemaining: context.stepsRemaining, readsRemaining, recentTurns: request.recentTurns.slice(-6), details: view.details })
      const validation = await plan(request, record, system, user, { ...context, evidence: view.evidence, answerable: view.answerable, readable: readsRemaining > 0 ? view.readable : null })
      record.navigation = { ...workspace.trace(), readRounds: reads, excludedByAccess: knowledge.excludedByAccess }
      if (!validation || !validation.ok || validation.plan.decision !== "READ") return validation
      workspace.open(validation.plan.read.documentIds)
      workspace.read(validation.plan.read.sections)
    }
  }

  /** UMA chamada do planejador, com UMA correção quando a resposta sai do contrato. null = a IA falhou (transporte/provedor). */
  async function plan(request: ClarificationRequest, record: ClarificationTrace, system: string, user: string, context: PlannerValidationContext): Promise<PlannerValidation | null> {
    try {
      record.plannerAttempts += 1
      const first = await deps.model({ organizationId: request.organizationId, stage: "PLANNER", system, user, correction: false })
      let validation = validatePlannerOutput(first, context)
      record.rejectedOptions.push(...validation.rejectedOptions)
      if (!validation.ok) {
        record.issues.push(...validation.issues.map((issue) => issue.message))
        record.plannerAttempts += 1
        const second = await deps.model({ organizationId: request.organizationId, stage: "PLANNER", system, user: `${user}\n\n${renderCorrection(validation.issues)}\n\nRESPOSTA ANTERIOR (rejeitada):\n${first.slice(0, 6_000)}`, correction: true })
        validation = validatePlannerOutput(second, context)
        record.rejectedOptions.push(...validation.rejectedOptions)
        if (!validation.ok) record.issues.push(...validation.issues.map((issue) => issue.message))
      }
      if (validation.ok) record.decision = validation.plan.decision
      return validation
    } catch (error) {
      rethrowIfCancelled(error)
      logFailure("planner", error)
      return null
    }
  }

  /** Aplica a decisão validada. null = a resposta final falhou (o chamador decide entre PASS e erro). */
  async function conclude(request: ClarificationRequest, record: ClarificationTrace, state: ClarificationState, result: ValidatedPlan, navigation: Navigation): Promise<ClarificationOutcome | null> {
    const at = now().toISOString()
    const coverage = navigation.workspace.coverage()
    if (result.decision === "CLARIFY" && result.step) {
      const position = answeredStepsOf(state).length + 1
      const step: ClarificationStep = { id: stepIdFor(position, result.step.dimension), ...result.step, answer: null }
      const next: ClarificationState = { ...state, status: "OPEN", steps: [...state.steps.filter((existing) => existing.answer !== null), step], coverage, sources: [], conflicts: [], notice: null, updatedAt: at }
      return { kind: "REPLY", content: renderClarificationContent(step), state: next, trace: record }
    }
    if (result.decision === "INSUFFICIENT" && result.insufficient) {
      const notice = result.insufficient.reason
      const ask = result.insufficient.ask ?? "Se puder, descreva o caso com mais detalhes ou reformule a pergunta."
      const content = `Não encontrei nas bases consultadas uma orientação que sustente a resposta para este caso. ${notice}\n\n${ask} Se a dúvida continuar, procure a sua liderança imediata.`
      return { kind: "REPLY", content, state: { ...state, status: "INSUFFICIENT", coverage, sources: [], conflicts: [], notice, updatedAt: at }, trace: record }
    }
    if (result.decision !== "ANSWER") return null
    const answer = await composeAnswer(request, record, state, result, navigation)
    if (!answer) return null
    const next: ClarificationState = { ...state, status: "ANSWERED", coverage, sources: answer.sources, conflicts: result.conflicts.map((conflict) => ({ description: conflict.description, sources: conflict.sources })), notice: answer.limitations, updatedAt: at }
    return { kind: "REPLY", content: answer.text, state: next, trace: record }
  }

  /** Leitura do texto inteiro das seções escolhidas (na versão desta pergunta) + resposta com marcadores, com UMA correção. */
  async function composeAnswer(request: ClarificationRequest, record: ClarificationTrace, state: ClarificationState, result: ValidatedPlan, navigation: Navigation) {
    const { workspace, knowledge } = navigation
    const sections: AnswerSection[] = []
    let chars = 0
    const add = (ref: string, source: AnswerSection["source"]) => {
      if (sections.some((section) => section.ref === ref)) return
      const text = workspace.textOf(source)
      if (!text || chars + text.length > 24_000) return
      sections.push({ ref, source, text })
      chars += text.length
    }
    for (const { ref, source } of result.answerEvidence) add(ref, source)
    const conflicts = result.conflicts.map((conflict) => ({ description: conflict.description, refs: conflict.sources.map((source) => workspace.refFor(source)).filter((ref): ref is string => Boolean(ref)) }))
    for (const conflict of result.conflicts) for (const source of conflict.sources) {
      const ref = workspace.refFor(source)
      if (ref?.startsWith("K")) add(ref, source)
    }
    if (sections.length === 0) {
      record.issues.push("Nenhuma seção aplicável pôde ser lida.")
      return null
    }
    const owners = [...new Set(sections.flatMap((section) => knowledge.sources.get(section.source.documentId)?.agentIds ?? []))]
    const user = renderAnswerInput({ state, sections, conflicts, glossary: knowledge.glossary })
    try {
      const [guardrails, instructions] = await Promise.all([deps.guardrails(request.organizationId, [...(request.orchestratorAgentId ? [request.orchestratorAgentId] : []), ...owners]), deps.specialistInstructions(request.organizationId, owners)])
      const system = [ANSWER_SYSTEM, instructions, guardrails].filter(Boolean).join("\n\n")
      const evidence = new Map(sections.map((section) => [section.ref, section.source]))
      record.answerAttempts = 1
      const first = await deps.model({ organizationId: request.organizationId, stage: "ANSWER", system, user, correction: false })
      let validation = validateAnswerOutput(first, evidence)
      if (!validation.ok) {
        record.issues.push(...validation.issues)
        record.answerAttempts = 2
        const second = await deps.model({ organizationId: request.organizationId, stage: "ANSWER", system, user: `${user}\n\n${renderCorrection(validation.issues)}\n\nRESPOSTA ANTERIOR (rejeitada):\n${first.slice(0, 8_000)}`, correction: true })
        validation = validateAnswerOutput(second, evidence)
        if (!validation.ok) record.issues.push(...validation.issues)
      }
      return validation.ok ? validation : null
    } catch (error) {
      rethrowIfCancelled(error)
      logFailure("answer", error)
      return null
    }
  }

  function notConverged(state: ClarificationState, navigation: Navigation, record: ClarificationTrace, issues: readonly PlannerIssue[]): ClarificationOutcome {
    record.decision = "NOT_CONVERGED"
    const scenario = describeScenario(state)
    const notice = "O esclarecimento não convergiu para um cenário documentado dentro do limite de etapas."
    const content = [
      "Ainda não consegui identificar o cenário com segurança a partir das bases consultadas, e não vou indicar um procedimento sem uma fonte que sustente o seu caso.",
      scenario ? `Até aqui: ${scenario}.` : "",
      "Para continuar, descreva em uma frase a situação do cliente — o que torna este caso diferente — ou reformule a pergunta.",
    ].filter(Boolean).join("\n\n")
    record.issues.push(...issues.map((issue) => issue.message))
    return { kind: "REPLY", content, state: { ...state, status: "NOT_CONVERGED", steps: state.steps.filter((step) => step.answer !== null), coverage: navigation.workspace.coverage(), sources: [], conflicts: [], notice, updatedAt: now().toISOString() }, trace: record }
  }
}

/** O que a pergunta informava: os fatos já gravados continuam; os novos entram sem repetir dimensão (nem as das etapas). */
function mergeFacts(existing: readonly QuestionFact[], incoming: readonly QuestionFact[], steps: readonly ClarificationStep[]): QuestionFact[] {
  const taken = new Set([...existing.map((fact) => normalizeLabel(fact.dimension)), ...steps.map((step) => normalizeLabel(step.dimension))])
  const merged = [...existing]
  for (const fact of incoming) {
    if (merged.length >= MAX_QUESTION_FACTS) break
    if (taken.has(normalizeLabel(fact.dimension))) continue
    taken.add(normalizeLabel(fact.dimension))
    merged.push(fact)
  }
  return merged
}

function logFailure(stage: string, error: unknown): void {
  console.error(JSON.stringify({ event: "knowledge_clarification_failed", stage, message: (error as Error)?.message ?? String(error) }))
}

/** Interruptor operacional: `INIA_KNOWLEDGE_CLARIFICATION=off` desliga o esclarecimento (o chat volta ao caminho de sempre). Padrão:
 * ligado. Lido a cada mensagem — vale sem reiniciar o processo. */
export function knowledgeClarificationEnabled(): boolean {
  const value = process.env.INIA_KNOWLEDGE_CLARIFICATION?.trim().toLowerCase()
  return !(value === "off" || value === "false" || value === "0")
}
