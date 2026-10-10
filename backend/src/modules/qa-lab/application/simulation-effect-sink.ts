import { readSupportMaterials } from "../../feedbacks/domain/support-material.js"
import type { WorkflowEffectSink } from "../../workflows/application/effect-sink.js"
import type { QaEffect } from "../domain/qa-run-schema.js"
import type { GenerationOutcome, GenerationRequest } from "../../interaction-feedback/application/generate-interaction-feedback.js"
import { simulateInteractionFeedbackGeneration } from "../../interaction-feedback/application/simulate-interaction-feedback.js"
import { createPostgresFeedbackGenerationRegistry } from "../../interaction-feedback/infrastructure/postgres-feedback-generation-registry.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { generateReliableFeedback, type ReliableGenerationRequest, type ReliableGenerationResult } from "../../reliable-feedback/application/generate-reliable-feedback.js"
import { createReliableGenerationDeps } from "../../reliable-feedback/application/reliable-feedback-wiring.js"
import { createInMemoryReliableFeedbackStore } from "../../reliable-feedback/infrastructure/in-memory-reliable-feedback-store.js"
import type { ReliableFeedbackStore } from "../../reliable-feedback/application/ports.js"
import { projectionSourceOfNodeOutput, reliableProjectionSourceFrom } from "../../conversational-delivery/application/conversational-effects.js"
import type { ConversationalDeliveryInput } from "../../conversational-delivery/application/deliver-conversational-output.js"
import { createSimulationFeedbackEngineEffects, type FeedbackEngineEffects } from "../../feedback-engine/application/engine-wiring.js"
import type { EngineModelPort } from "../../feedback-engine/application/ports.js"

/**
 * `WorkflowEffectSink` do modo QA_SIMULATION — a contraparte de `productionEffects`
 * (workflows/application/effect-sink.ts). Nenhum método toca o banco: cada efeito vira uma
 * entrada em `effects` ("o que teria acontecido") com ids sintéticos, e o motor segue como se
 * o efeito tivesse ocorrido (um Output que "criou" um caso devolve um caseId, que um Escalonar
 * posterior encontra via `findRecentCaseId`, exatamente como em produção).
 *
 * `beginNode` é chamado pelo runner antes de cada `processNode` — é assim que cada efeito fica
 * atribuído ao node que o produziu (a interface do sink, compartilhada com a produção, não
 * carrega nodeId em todo primitivo).
 */
export class SimulationEffectSink implements WorkflowEffectSink {
  readonly effects: QaEffect[] = []
  private currentNodeId: string | null = null
  private sequence = 0

  private readonly simulateFeedback: (db: Database, request: GenerationRequest) => Promise<GenerationOutcome>
  private readonly simulateReliable: (db: Database, request: ReliableGenerationRequest) => Promise<ReliableGenerationResult>
  private readonly reliableStore: ReliableFeedbackStore

  private readonly engine: FeedbackEngineEffects

  constructor(initialEffects: QaEffect[] = [], options: { simulateInteractionFeedback?: (db: Database, request: GenerationRequest) => Promise<GenerationOutcome>; simulateReliableFeedback?: (db: Database, request: ReliableGenerationRequest) => Promise<ReliableGenerationResult>; engineModel?: EngineModelPort } = {}) {
    // MOTOR DE FEEDBACK: mesma lógica da produção com memória em RAM — nenhuma análise, mensagem ou material é gravado.
    this.engine = createSimulationFeedbackEngineEffects(options.engineModel ? { model: options.engineModel } : {})
    this.simulateFeedback = options.simulateInteractionFeedback ?? ((db, request) => simulateInteractionFeedbackGeneration(db, request))
    // Store EFÊMERO (nada gravado); leitura real (transcrição/medição, só SELECT) e o MESMO redator da produção (sujeito à
    // política de IA do QA Lab: "Parar antes da IA"/orçamento).
    const reliableStore = createInMemoryReliableFeedbackStore()
    this.reliableStore = reliableStore
    this.simulateReliable = options.simulateReliableFeedback ?? ((db, request) => generateReliableFeedback({ ...createReliableGenerationDeps({ db }), store: reliableStore }, request))
    this.effects = [...initialEffects]
    this.sequence = initialEffects.reduce((max, effect) => Math.max(max, effect.id), 0)
  }

  beginNode(nodeId: string | null): void {
    this.currentNodeId = nodeId
  }

  private nextId(): number {
    this.sequence += 1
    return this.sequence
  }

  async dispatchAlert(_db: unknown, input: Parameters<WorkflowEffectSink["dispatchAlert"]>[1]): Promise<void> {
    this.effects.push({
      kind: "ALERT",
      id: this.nextId(),
      nodeId: this.currentNodeId,
      alertType: input.alertType,
      recipientId: input.recipientId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      caseId: input.caseId,
      surfaces: surfacesForAlert(input.dedupeKey),
    })
  }

  async dispatchWorkflowOutputRows(
    _db: unknown,
    _context: { organizationId: string; enrollmentId: string; nodeId: string },
    config: { interactionMode?: string | undefined },
    surface: string,
    recipientIds: string[],
    content: unknown,
  ): Promise<void> {
    for (const recipientId of recipientIds) {
      this.effects.push({
        kind: "WORKFLOW_OUTPUT",
        id: this.nextId(),
        nodeId: this.currentNodeId,
        surface,
        recipientId,
        interactionMode: config.interactionMode ?? "PROMPT",
        content,
      })
    }
  }

  async publishFeedback(_db: unknown, publication: Parameters<WorkflowEffectSink["publishFeedback"]>[1]): Promise<{ caseId: string; feedbackId: string }> {
    const id = this.nextId()
    const caseId = `qa-case-${id}`
    const feedbackId = `qa-feedback-${id}`
    const structured =
      publication.kind === "orchestrator"
        ? null
        : (publication.input.structured as { title?: string; recommendation?: string; evidenceFound?: string } | undefined)
    const supportMaterials = readSupportMaterials(publication.input)
    this.effects.push({
      kind: "FEEDBACK",
      id,
      nodeId: this.currentNodeId,
      feedbackKind: publication.kind,
      operatorId: publication.input.operatorId,
      teamId: publication.input.teamId,
      caseId,
      feedbackId,
      title: publication.kind === "orchestrator" ? `Análise de ${publication.input.orchestratorName}` : (structured?.title ?? null),
      recommendation: publication.kind === "orchestrator" ? publication.input.reply.text : (structured?.recommendation ?? null),
      evidenceFound:
        publication.kind === "monitoring"
          ? (structured?.evidenceFound ?? null)
          : publication.kind === "indicator"
            ? publication.input.evidenceFound
            : null,
      ...(supportMaterials.length > 0 ? { supportMaterials } : {}),
      input: publication.input,
    })
    return { caseId, feedbackId }
  }

  async setConfigValue(_db: unknown, input: Parameters<WorkflowEffectSink["setConfigValue"]>[1]): Promise<void> {
    this.effects.push({
      kind: "CONFIG_VALUE",
      id: this.nextId(),
      nodeId: this.currentNodeId,
      configKey: input.configKey,
      valueType: input.valueType,
      value: input.value,
      scopeType: input.scopeType,
      teamId: input.teamId,
      subteamId: input.subteamId,
    })
  }

  async findRecentCaseId(): Promise<string | null> {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index]!
      if (effect.kind === "FEEDBACK" || effect.kind === "RELIABLE_FEEDBACK_EMISSION") return effect.caseId
    }
    return null
  }

  readonly agentRuns: WorkflowEffectSink["agentRuns"] = {
    start: async (_db, input) => {
      const id = this.nextId()
      const runId = `qa-agent-run-${id}`
      this.effects.push({ kind: "AGENT_RUN", id, nodeId: this.currentNodeId, runId, agentId: input.agentId, status: "PENDING", outputText: null, errorMessage: null })
      return runId
    },
    complete: async (_db, runId, outputText) => {
      const run = this.findAgentRun(runId)
      if (run) Object.assign(run, { status: "COMPLETED", outputText })
    },
    fail: async (_db, runId, message, outputText) => {
      const run = this.findAgentRun(runId)
      if (run) Object.assign(run, { status: "FAILED", errorMessage: message, ...(outputText ? { outputText } : {}) })
    },
  }

  /**
   * V1.5.10 — nada é reservado nem gerado de verdade: a seleção é só calculada (lendo, sem gravar, o que o nó já atendeu —
   * para mostrar a mesma amostra que a produção escolheria) e a geração roda com store efêmero.
   */
  readonly interactionFeedback: WorkflowEffectSink["interactionFeedback"] = {
    persistedSelection: async () => [],
    selectedInteractionIds: (db, scope) => createPostgresFeedbackGenerationRegistry(db).selectedInteractionIds(scope),
    reserveSelection: async (_db, requests) => requests.map((request) => request.interactionId),
    generate: async (db, request) => {
      const outcome = await this.simulateFeedback(db, request)
      this.effects.push({
        kind: "INTERACTION_FEEDBACK",
        id: this.nextId(),
        nodeId: this.currentNodeId,
        interactionId: outcome.interactionId,
        status: outcome.status,
        notAnalyzableReason: outcome.notAnalyzableReason,
        feedbackStatus: outcome.feedbackStatus,
        writerInvoked: outcome.writerInvoked,
        dispositions: { ...outcome.dispositions },
        reasons: [...outcome.reasons],
        policyVersion: outcome.policyVersion,
      })
      return outcome
    },
  }

  /** V1.5.12 — artefato confiável simulado + a emissão que o Output faria (idempotente também na simulação). */
  readonly reliableFeedback: WorkflowEffectSink["reliableFeedback"] = {
    generate: async (db, request) => {
      const result = await this.simulateReliable(db, request)
      const output = result.nodeOutput
      this.effects.push({
        kind: "RELIABLE_FEEDBACK",
        id: this.nextId(),
        nodeId: this.currentNodeId,
        domain: output.domain,
        sourceNodeId: output.sourceNodeId,
        sourceType: output.sourceType,
        disposition: output.disposition,
        itemCount: result.record.artifact?.items.length ?? 0,
        emittableCount: output.items.length,
        reasons: [...output.reasons],
        policyVersion: output.policyVersion,
        writerInvoked: result.record.artifact?.writer.invoked ?? false,
        text: output.text,
      })
      return result
    },
    publishFollowUp: async (_db, input) => {
      const existing = this.effects.find((effect): effect is Extract<QaEffect, { kind: "RELIABLE_FEEDBACK_EMISSION" }> => effect.kind === "RELIABLE_FEEDBACK_EMISSION" && effect.nodeId === this.currentNodeId && effect.recipientId === input.recipientId)
      if (existing) return { caseId: existing.caseId, feedbackId: existing.feedbackId, reused: true }
      const id = this.nextId()
      const emission = { kind: "RELIABLE_FEEDBACK_EMISSION" as const, id, nodeId: this.currentNodeId, surface: "FOLLOW_UP" as const, recipientId: input.recipientId, artifactId: input.artifactId, caseId: `qa-case-${id}`, feedbackId: `qa-feedback-${id}`, reused: false }
      this.effects.push(emission)
      return { caseId: emission.caseId, feedbackId: emission.feedbackId, reused: false }
    },
  }

  /**
   * MOTOR DE FEEDBACK simulado. A mensagem é registrada no efeito RELIABLE_FEEDBACK (a mesma entrada que a tela do QA Lab já
   * mostra): READY = publicável; BLOCKED = abstenção, com o motivo em `reasons`. Publicação = RELIABLE_FEEDBACK_EMISSION.
   */
  readonly feedbackEngine: WorkflowEffectSink["feedbackEngine"] = {
    analyzeCall: (db, request) => this.engine.analyzeCall(db, request),
    investigateIndicator: (db, request) => this.engine.investigateIndicator(db, request),
    generate: async (db, request) => {
      const result = await this.engine.generate(db, request)
      const sourceType = request.sourceNodeOutput && typeof request.sourceNodeOutput === "object" && Array.isArray((request.sourceNodeOutput as { results?: unknown }).results) ? "ORCHESTRATOR" : "AGENT"
      this.effects.push({
        kind: "RELIABLE_FEEDBACK",
        id: this.nextId(),
        nodeId: this.currentNodeId,
        domain: request.domain,
        sourceNodeId: request.sourceNodeId,
        sourceType,
        disposition: result.kind === "PUBLISHABLE" ? "READY" : "BLOCKED",
        itemCount: result.kind === "PUBLISHABLE" ? result.nodeOutput.findings.developments + result.nodeOutput.findings.strengths + result.nodeOutput.findings.suppressed : 0,
        emittableCount: result.kind === "PUBLISHABLE" ? result.nodeOutput.findings.developments + result.nodeOutput.findings.strengths : 0,
        reasons: result.kind === "PUBLISHABLE" ? [] : [result.reason],
        policyVersion: "FEEDBACK_ENGINE_V1",
        writerInvoked: result.kind === "PUBLISHABLE",
        text: result.kind === "PUBLISHABLE" ? result.nodeOutput.text : "",
      })
      return result
    },
    publishFollowUp: async (db, input) => {
      const existing = this.effects.find((effect): effect is Extract<QaEffect, { kind: "RELIABLE_FEEDBACK_EMISSION" }> => effect.kind === "RELIABLE_FEEDBACK_EMISSION" && effect.nodeId === this.currentNodeId && effect.recipientId === input.recipientId)
      if (existing) return { caseId: existing.caseId, feedbackId: existing.feedbackId, reused: true }
      const published = await this.engine.publishFollowUp(db, input)
      if (published.skipped) return published
      const id = this.nextId()
      const emission = { kind: "RELIABLE_FEEDBACK_EMISSION" as const, id, nodeId: this.currentNodeId, surface: "FOLLOW_UP" as const, recipientId: input.recipientId, artifactId: input.messageId, caseId: `qa-case-${id}`, feedbackId: `qa-feedback-${id}`, reused: false }
      this.effects.push(emission)
      return { caseId: emission.caseId, feedbackId: emission.feedbackId, reused: false }
    },
    projectionSource: (db, input) => this.engine.projectionSource(db, input),
    markDelivered: (db, input) => this.engine.markDelivered(db, input),
    deliveredMonitoring: (db, input) => this.engine.deliveredMonitoring(db, input),
    deliverySkip: (db, input) => this.engine.deliverySkip(db, input),
  }

  /**
   * Workflow Outputs V1 — Chat/Avatar simulados: nenhuma conversa, mensagem, convite ou aviso é gravado; o efeito registra o
   * que o destinatário receberia (título, primeira mensagem, fala). Idempotente por nó × superfície × destinatário.
   */
  private recordConversational(surface: "CHAT" | "AVATAR", input: ConversationalDeliveryInput): { id: number; reused: boolean } {
    const existing = this.effects.find((effect): effect is Extract<QaEffect, { kind: "WORKFLOW_OUTPUT" }> => effect.kind === "WORKFLOW_OUTPUT" && effect.nodeId === this.currentNodeId && effect.surface === surface && effect.recipientId === input.recipientId)
    if (existing) return { id: existing.id, reused: true }
    const id = this.nextId()
    const content = surface === "CHAT"
      ? { title: input.projection.title, firstMessage: input.projection.chatText, projectionVersion: input.projection.version }
      : { title: input.projection.title, speechText: input.projection.speechText, displayText: input.projection.displayText, projectionVersion: input.projection.version, note: "A fala só começa quando a pessoa aceitar ouvir o recado." }
    this.effects.push({ kind: "WORKFLOW_OUTPUT", id, nodeId: this.currentNodeId, surface, recipientId: input.recipientId, interactionMode: input.interactionMode, content })
    return { id, reused: false }
  }

  readonly conversational: WorkflowEffectSink["conversational"] = {
    reliableProjectionSource: async (_db, input) => {
      // Artefato gerado fora deste store (simulação injetada nos testes): a projeção sai do próprio nó. Com o artefato no
      // store, as MESMAS defesas da produção valem (inclusive destinatário ≠ colaborador = erro).
      if (!(await this.reliableStore.get(input.organizationId, input.artifactId))) return projectionSourceOfNodeOutput(input.nodeOutput)
      return reliableProjectionSourceFrom(this.reliableStore, input)
    },
    deliverChat: async (_db, input) => {
      const recorded = this.recordConversational("CHAT", input)
      return { outputId: `qa-output-${recorded.id}`, conversationId: `qa-conversation-${recorded.id}`, reused: recorded.reused }
    },
    offerAvatar: async (_db, input) => {
      const recorded = this.recordConversational("AVATAR", input)
      return { outputId: `qa-output-${recorded.id}`, reused: recorded.reused }
    },
  }

  private findAgentRun(runId: string) {
    return this.effects.find((effect): effect is Extract<QaEffect, { kind: "AGENT_RUN" }> => effect.kind === "AGENT_RUN" && effect.runId === runId)
  }
}

/** A superfície pedida no node fica codificada no dedupeKey do alerta (`...:<surface>:<recipient>`
 * no Escalonar; Output/Human Review usam FOLLOW_UP/NOTIFICATION indistintamente na mesma tabela
 * `alerts`) — extraída só pra exibição amigável. */
function surfacesForAlert(dedupeKey: string): string[] {
  const match = /:(FOLLOW_UP|NOTIFICATION):/.exec(dedupeKey)
  return match ? [match[1]!] : ["FOLLOW_UP", "NOTIFICATION"]
}
