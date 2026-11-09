import { randomUUID } from "node:crypto"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AiCallCancelledError, AiProviderError } from "../../../shared/application/model-routing/ai-errors.js"
import { currentAiAbortSignal } from "../../../shared/application/model-routing/ai-runtime.js"
import { currentChatTurnTrace } from "../../../shared/application/observability/chat-turn-trace.js"
import type { ReadableKnowledge, ReadableKnowledgeRequest } from "../../knowledge/application/knowledge-catalog.js"
import { createAnswerStream } from "../domain/answer-stream.js"
import { CONVERGENCE_ISSUES, validateAnswerOutput, validatePlannerOutput, type AnswerValidation, type PlannerIssue, type PlannerValidation, type PlannerValidationContext, type PresentedEvidence, type RejectedOption, type ValidatedPlan } from "../domain/clarification-contract.js"
import { ANSWER_SYSTEM, renderAnswerInput, renderCorrection, renderPlannerInput, renderPlannerSystem, SESSION_ANSWER_RULE, type AnswerSection, type PlannerInput } from "../domain/clarification-prompts.js"
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
  /**
   * Sessão de feedback (`PRODUCT_APPLICABILITY_V1`): o registro do que a análise da gravação estabeleceu sobre o atendimento (ex.: produto
   * não estabelecido e os pontos que dependem dele). Dado para o planejador e regra para a resposta; ausente = chat de sempre.
   */
  sessionContext?: string | null
  /** Chat de texto: a resposta (ANSWER) aparece enquanto é redigida. Ausente = só a resposta inteira e validada (voz, liderança). */
  stream?: ClarificationStream | null
}

/**
 * A resposta pelas bases em fluxo: o texto da redação vai para a tela enquanto chega, só até onde a conferência incremental dos
 * marcadores passa (`answer-stream.ts`). Quem decide continua sendo a validação final: recusada (ou a chamada falhou), o que
 * apareceu é retirado (`retract`) ANTES da correção ou do caminho de sempre. `status`: o que está acontecendo (nunca conteúdo).
 */
export type ClarificationStream = { text(chunk: string): void; retract(): void; status?(label: string): void }

export const ANSWER_DRAFTING_STATUS = "Escrevendo a resposta com as fontes…"

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
  /** Cada chamada à IA nesta mensagem, em ordem: etapa, correção e o que decidiu (ex.: `PLANNER READ +1B +4K`, `ANSWER OK`). Sem
   * conteúdo — mostra quantas rodadas a pergunta custou. */
  calls?: string[]
}

/**
 * `groundedOn`: o texto das seções em que uma resposta (ANSWERED) se apoiou, para a conferência (PEN-017) saber o que veio da base. Só neste turno: o estado
 * gravado guarda referências, nunca o texto.
 */
export type ClarificationOutcome =
  | { kind: "PASS"; reason: ClarificationPassReason; trace: ClarificationTrace }
  | { kind: "REPLY"; content: string; state: ClarificationState; trace: ClarificationTrace; groundedOn?: { documentTitle: string; heading: string; excerpt: string }[] }

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
      const user = renderPlannerInput({ ...conversation, stepsRemaining: context.stepsRemaining, readsRemaining, recentTurns: request.recentTurns.slice(-6), details: view.details, sessionContext: request.sessionContext ?? null })
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
      noteCall(record, plannerCallLabel(validation, false))
      record.rejectedOptions.push(...validation.rejectedOptions)
      if (!validation.ok) {
        record.issues.push(...validation.issues.map((issue) => issue.message))
        record.plannerAttempts += 1
        const second = await deps.model({ organizationId: request.organizationId, stage: "PLANNER", system, user: `${user}\n\n${renderCorrection(validation.issues)}\n\nRESPOSTA ANTERIOR (rejeitada):\n${first.slice(0, 6_000)}`, correction: true })
        validation = validatePlannerOutput(second, context)
        noteCall(record, plannerCallLabel(validation, true))
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
    const next: ClarificationState = { ...state, status: "ANSWERED", coverage, sources: answer.sources.map((source) => navigation.workspace.withImages(source)), conflicts: result.conflicts.map((conflict) => ({ description: conflict.description, sources: conflict.sources })), notice: answer.limitations, updatedAt: at }
    return { kind: "REPLY", content: answer.text, state: next, trace: record, groundedOn: answer.sections.map((section) => ({ documentTitle: section.source.documentTitle, heading: section.source.heading, excerpt: section.text })) }
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
      const system = [ANSWER_SYSTEM, request.sessionContext ? SESSION_ANSWER_RULE : null, instructions, guardrails].filter(Boolean).join("\n\n")
      const evidence = new Map(sections.map((section) => [section.ref, section.source]))
      record.answerAttempts = 1
      request.stream?.status?.(ANSWER_DRAFTING_STATUS)
      // Falha passageira do provedor: UMA nova tentativa por mensagem (vale para a redação e para a correção).
      let providerRetried = false
      const draft = async (input: Omit<Parameters<ClarificationModel>[0], "onText">, label: string) => {
        try {
          return await draftAnswer(request, input, evidence)
        } catch (error) {
          rethrowIfCancelled(error)
          const category = transientProviderFailure(error)
          if (!category || providerRetried) throw error
          providerRetried = true
          logFailure("answer", error)
          noteCall(record, `${label} RETRY(${category})`)
          return draftAnswer(request, input, evidence)
        }
      }
      const first = await draft({ organizationId: request.organizationId, stage: "ANSWER", system, user, correction: false }, "ANSWER")
      let validation = first.validation
      noteCall(record, `ANSWER ${validation.ok ? "OK" : "INVALID"}`)
      if (!validation.ok) {
        record.issues.push(...validation.issues)
        record.answerAttempts = 2
        const second = await draft({ organizationId: request.organizationId, stage: "ANSWER", system, user: `${user}\n\n${renderCorrection(validation.issues)}\n\nRESPOSTA ANTERIOR (rejeitada):\n${first.raw.slice(0, 8_000)}`, correction: true }, "ANSWER(fix)")
        validation = second.validation
        noteCall(record, `ANSWER(fix) ${validation.ok ? "OK" : "INVALID"}`)
        if (!validation.ok) record.issues.push(...validation.issues)
      }
      return validation.ok ? { ...validation, sections } : null
    } catch (error) {
      rethrowIfCancelled(error)
      logFailure("answer", error)
      return null
    }
  }

  /** Uma redação. Em fluxo, o texto aparece enquanto chega e é retirado quando a validação final recusa ou a chamada falha. */
  async function draftAnswer(request: ClarificationRequest, input: Omit<Parameters<ClarificationModel>[0], "onText">, evidence: PresentedEvidence): Promise<{ raw: string; validation: AnswerValidation }> {
    const stream = request.stream
    const live = stream ? createAnswerStream(evidence, (text) => stream.text(text)) : null
    try {
      const raw = await deps.model(live ? { ...input, onText: (text) => live.push(text) } : input)
      const validation = validateAnswerOutput(raw, evidence)
      if (!validation.ok && live?.emitted()) stream!.retract()
      return { raw, validation }
    } catch (error) {
      if (live?.emitted()) stream!.retract()
      throw error
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

/**
 * Falha PASSAGEIRA do provedor na redação da resposta (erro do servidor dele, rede, modelo indisponível): vale UMA nova tentativa
 * antes de desistir — desistir joga a pergunta no caminho de sempre, 50 a 60 s mais lento (1 de 20 turnos na medição de 22/10/2026:
 * "O modelo de IA não retornou uma resposta válida", 0,9 s). Estouro de tempo não repete (custaria o mesmo que o caminho de sempre),
 * limite de uso fica com o limitador de chamadas e resposta recusada pela conferência tem a correção própria. A categoria vem do
 * erro normalizado do gateway (policy: `AiProviderError`; legado: `details.category`).
 */
const TRANSIENT_PROVIDER_FAILURES: ReadonlySet<string> = new Set(["PROVIDER_ERROR", "NETWORK", "MODEL_UNAVAILABLE"])

function transientProviderFailure(error: unknown): string | null {
  if (!(error instanceof DomainError)) return null
  const details = (error.details && typeof error.details === "object" ? error.details : {}) as { category?: unknown }
  const category = error instanceof AiProviderError ? error.category : typeof details.category === "string" ? details.category : error.code.includes("NETWORK") ? "NETWORK" : null
  return category && TRANSIENT_PROVIDER_FAILURES.has(category) ? category : null
}

function plannerCallLabel(validation: PlannerValidation, correction: boolean): string {
  const stage = correction ? "PLANNER(fix)" : "PLANNER"
  if (!validation.ok) return `${stage} INVALID`
  const { plan } = validation
  return plan.decision === "READ" ? `${stage} READ +${plan.read.documentIds.length}B +${plan.read.sections.length}K` : `${stage} ${plan.decision}`
}

/** Rastro das chamadas (gravado com a resposta e no rastreamento do turno do chat, `clarificationCalls`). */
function noteCall(record: ClarificationTrace, label: string): void {
  record.calls = [...(record.calls ?? []), label]
  currentChatTurnTrace()?.note("clarificationCalls", record.calls.join(" > "))
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
