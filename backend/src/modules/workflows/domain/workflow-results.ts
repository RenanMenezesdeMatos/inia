import { currentDisposition, emittedItems, findingsSummaryOf, presentationOf, SECTION_LABELS, type ArtifactReviewState, type FindingsSummary, type ReliableFeedbackArtifactV1 } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import { isEmittableSection, type EmittableSection, type ReliableFact } from "../../reliable-feedback/domain/reliable-feedback-item.js"
import type { FlowGraph } from "./graph-schema.js"

/**
 * V1.5.13 — RESULTADOS DO WORKFLOW (read model, domínio puro).
 *
 * DISPARO = uma matrícula RAIZ (`parent_enrollment_id` nulo). Um fan-out (1 raiz → N filhos) é UM disparo com N pessoas
 * processadas — nunca N+1 disparos; nada é agrupado por horário. PESSOA PROCESSADA = matrícula com colaborador próprio:
 * o filho de um fan-out, ou a própria raiz num Workflow individual (a raiz de um Workflow Consolidado é a estrutura, não
 * uma pessoa).
 *
 * Fonte da verdade, nesta ordem (§15): efeito persistido (emissão/feedback/alerta/linha de superfície) > artefato
 * confiável + decisões do QA (a MESMA função `emittedItems` que o publicador usa — texto final do QA quando editado) >
 * saída do nó (`node_outputs`, só onde ela é a fonte: o feedbackId do Output legado) > evento técnico (destinatários
 * pedidos, erro). "Enviado" só com efeito persistido — nunca porque o nó Output executou.
 *
 * Uso de IA: `ai_usage_events` correlacionado pelo motor (matrícula/raiz/nó — migration 084). Tokens e custo são os
 * REGISTRADOS; o que o provider não informou é N/D (null), nunca estimado.
 */

export type DispatchStatus = "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED"
export type TriggerKind = "FLAG" | "INDICATOR" | "SCHEDULE" | "MANUAL"
export type EnrollmentStatus = "active" | "waiting" | "completed" | "failed" | "dead"

// ---------------------------------------------------------------------------------------------
// USO DE IA
// ---------------------------------------------------------------------------------------------

export type CostByCurrency = { currency: string; amount: string }

/** Totais de uso REGISTRADO. Um campo é null quando nenhuma chamada o informou (N/D); `incomplete` = alguma chamada
 * concluída não informou tokens (o total é um piso). Custo por moeda (nunca convertido); `costUnknownCalls` = chamadas
 * concluídas sem preço/uso. */
export type UsageTotals = {
  calls: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  incomplete: boolean
  costs: CostByCurrency[]
  costUnknownCalls: number
}

export const EMPTY_USAGE: UsageTotals = { calls: 0, inputTokens: null, outputTokens: null, totalTokens: null, incomplete: false, costs: [], costUnknownCalls: 0 }

/** Soma decimal exata de strings numéricas (custo) — sem ponto flutuante. Escala 12 (a da coluna). */
function addDecimal(a: string, b: string): string {
  const scale = 12
  const toUnits = (value: string) => {
    const negative = value.trim().startsWith("-")
    const [whole = "0", fraction = ""] = value.trim().replace(/^[-+]/, "").split(".")
    const units = BigInt(whole || "0") * 10n ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0")
    return negative ? -units : units
  }
  const total = toUnits(a) + toUnits(b)
  const negative = total < 0n
  const abs = negative ? -total : total
  const whole = abs / 10n ** BigInt(scale)
  const fraction = (abs % 10n ** BigInt(scale)).toString().padStart(scale, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`
}

/** Forma canônica de um decimal vindo do banco (`numeric` com escala fixa): sem zeros à direita. */
export const normalizeDecimal = (value: string) => addDecimal(value, "0")

const addNullable = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b)

export function sumUsage(parts: readonly UsageTotals[]): UsageTotals {
  return parts.reduce<UsageTotals>((acc, part) => {
    const costs = [...acc.costs]
    for (const cost of part.costs) {
      const index = costs.findIndex((entry) => entry.currency === cost.currency)
      if (index >= 0) costs[index] = { currency: cost.currency, amount: addDecimal(costs[index]!.amount, cost.amount) }
      else costs.push({ ...cost })
    }
    return {
      calls: acc.calls + part.calls,
      inputTokens: addNullable(acc.inputTokens, part.inputTokens),
      outputTokens: addNullable(acc.outputTokens, part.outputTokens),
      totalTokens: addNullable(acc.totalTokens, part.totalTokens),
      incomplete: acc.incomplete || part.incomplete,
      costs: costs.sort((x, y) => x.currency.localeCompare(y.currency)),
      costUnknownCalls: acc.costUnknownCalls + part.costUnknownCalls,
    }
  }, EMPTY_USAGE)
}

/** Linha agregada de `ai_usage_events` por matrícula × nó × Use Case × modelo (uma consulta; nunca por accordion). */
export type UsageGroupRow = {
  enrollmentId: string
  nodeId: string | null
  useCase: string
  useCaseLabel: string
  providerKey: string
  modelName: string
  usage: UsageTotals
}

// ---------------------------------------------------------------------------------------------
// STATUS DO DISPARO
// ---------------------------------------------------------------------------------------------

/** Status do disparo pelo estado de TODAS as matrículas dele (raiz + filhos). */
export function dispatchStatusOf(statuses: readonly EnrollmentStatus[]): DispatchStatus {
  if (statuses.some((status) => status === "active" || status === "waiting")) return "RUNNING"
  if (statuses.every((status) => status === "completed")) return "COMPLETED"
  if (statuses.some((status) => status === "completed")) return "PARTIAL"
  return "FAILED"
}

/** A mesma regra em SQL (filtro/paginação no banco) — `s` = coluna de status das matrículas agregadas. */
export const DISPATCH_STATUS_SQL = (s: string) => `case
  when bool_or(${s} in ('active', 'waiting')) then 'RUNNING'
  when bool_and(${s} = 'completed') then 'COMPLETED'
  when bool_or(${s} = 'completed') then 'PARTIAL'
  else 'FAILED' end`

// ---------------------------------------------------------------------------------------------
// PESSOA DO DISPARO
// ---------------------------------------------------------------------------------------------

export type EventRow = {
  enrollmentId: string
  nodeId: string
  eventType: string
  actionType: string | null
  surfaces: string[] | null
  recipients: { id: string; name: string }[] | null
  message: string | null
  /** V1.7.1 — só em `orchestrator_executed`: DETERMINISTIC|MODEL e PASSTHROUGH|MODEL|NONE (ausente em eventos anteriores). */
  routingMode?: string | null
  synthesisMode?: string | null
  /** V1.7.1c — só em `node_failed`/`flow_dead` (ausente em eventos anteriores). */
  failure?: EventFailurePayload | null
  createdAt: string
}

/** V1.7.1c — o que o evento de falha registra (payload); campos ausentes em eventos anteriores. */
export type EventFailurePayload = {
  attempts?: number | null
  errorCategory?: string | null
  errorCategoryLabel?: string | null
  errorCode?: string | null
  willRetry?: boolean | null
  retryReason?: string | null
  nextRetryAt?: string | null
  repairAttempt?: boolean | null
  contract?: { name?: string | null; version?: string | null; violationCount?: number | null; violations?: { path: string; code: string }[] | null; rawResponseStored?: boolean | null } | null
  model?: string | null
  agentRunId?: string | null
}

/** V1.7.1c — falha técnica de um nó para a área administrativa: categoria, código, tentativa, campos inválidos e a decisão de
 * retry — sem conteúdo da resposta (a resposta bruta fica em agent_runs, apontada por `agentRunId`). */
export type ResultFailure = {
  label: string
  category: string | null
  code: string | null
  attempt: number | null
  willRetry: boolean | null
  retryReason: string | null
  nextRetryAt: string | null
  repairAttempt: boolean | null
  contract: { name: string | null; version: string | null; violationCount: number; fields: string[]; rawResponseStored: boolean } | null
  model: string | null
  agentRunId: string | null
}

export function resultFailureOf(payload: EventFailurePayload | null | undefined): ResultFailure | null {
  if (!payload || !payload.errorCategory) return null
  return {
    label: payload.errorCategoryLabel ?? payload.errorCategory,
    category: payload.errorCategory,
    code: payload.errorCode ?? null,
    attempt: payload.attempts ?? null,
    willRetry: payload.willRetry ?? null,
    retryReason: payload.retryReason ?? null,
    nextRetryAt: payload.nextRetryAt ?? null,
    repairAttempt: payload.repairAttempt ?? null,
    contract: payload.contract
      ? { name: payload.contract.name ?? null, version: payload.contract.version ?? null, violationCount: payload.contract.violationCount ?? 0, fields: [...new Set((payload.contract.violations ?? []).map((violation) => `${violation.path} (${violation.code})`))], rawResponseStored: payload.contract.rawResponseStored ?? false }
      : null,
    model: payload.model ?? null,
    agentRunId: payload.agentRunId ?? null,
  }
}

export type ArtifactRow = {
  id: string
  enrollmentId: string
  nodeId: string
  domain: "MONITORING" | "INDICATOR"
  status: "PENDING" | "COMPLETED" | "FAILED"
  disposition: "READY" | "HOLD_FOR_QA" | "BLOCKED" | "REJECTED" | null
  artifact: ReliableFeedbackArtifactV1 | null
  lastError: string | null
  completedAt: string | null
}

export type ReviewRow = ArtifactReviewState & { artifactId: string }
export type EmissionRow = { enrollmentId: string; nodeId: string; surface: string; recipientId: string; artifactId: string | null; engineMessageId?: string | null; feedbackId: string | null; createdAt: string }
/** Mensagem do motor de feedback (FEEDBACK_ENGINE_V1): publicável ou abstenção com motivo — nunca espera de QA. */
export type EngineMessageRow = {
  id: string
  enrollmentId: string
  nodeId: string
  domain: "MONITORING" | "INDICATOR"
  status: "RUNNING" | "PUBLISHABLE" | "ABSTAINED" | "FAILED"
  abstainReason: string | null
  label: string | null
  card: string | null
  paragraphs: string[] | null
  tone: string | null
  developments: number
  strengths: number
  error: string | null
}
export type AlertRow = { dedupeKey: string; createdAt: string }
export type SurfaceRow = { enrollmentId: string; nodeId: string; surface: string; recipientId: string; deliveredAt: string | null; createdAt: string }
export type LegacyFeedbackRow = {
  enrollmentId: string
  nodeId: string
  feedbackId: string
  status: string
  impactedIndicator: string
  observedBehavior: string
  recommendation: string
  evidenceFound: string
  publishedAt: string | null
}

export type PersonEnrollmentRow = {
  enrollmentId: string
  versionId: string
  status: EnrollmentStatus
  currentNodeId: string
  createdAt: string
  updatedAt: string
  subjectId: string
  subjectName: string
  teamName: string | null
  subteamName: string | null
}

/** V1.7.1a — `suggestedResponse` = exemplo de condução (só quando o item tem). */
export type ResultWording = { observed: string; whyItMatters: string; whatYouCanDo: string; suggestedResponse?: string }
export type ResultFact = { role: ReliableFact["role"]; text: string; truncated: boolean }

export type ResultFeedbackItem = {
  /** V1.7.1b: ATTENTION = "Vale confirmar o produto" (incerteza de aplicabilidade, nunca erro). */
  section: EmittableSection
  sectionLabel: string
  wording: ResultWording
  /** PROPOSED (texto do redator/fallback aceito) | HUMAN_EDITED (texto final do QA) — só o final é mostrado. */
  wordingSource: "PROPOSED" | "HUMAN_EDITED"
  qaStatus: "NOT_SELECTED_FOR_QA" | "PENDING_REVIEW" | "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "REJECTED"
  facts: ResultFact[]
  /** V1.7.1a — etapa do processo e posição na leitura (null em artefatos anteriores / fora da monitoria de processo). */
  stepTitle: string | null
  priorityRank: number | null
}

export type ResultFeedback = {
  /** ENGINE = motor de feedback (diagnóstico → mensagem); RELIABLE/LEGACY = caminhos anteriores, mantidos para leitura. */
  kind: "RELIABLE" | "LEGACY" | "ENGINE"
  nodeId: string
  nodeLabel: string
  domain: "MONITORING" | "INDICATOR" | null
  /** Rótulo exibível (data + assunto, ou indicador + período). */
  label: string | null
  disposition: "READY" | "HOLD_FOR_QA" | "BLOCKED" | "REJECTED" | "PENDING" | "FAILED" | "PUBLISHED" | "ABSTAINED"
  reasons: string[]
  items: ResultFeedbackItem[]
  /** V1.7.1a — análise completa × feedback: detectados, confiáveis, no feedback e o destino do resto (null no legado/pendente). */
  findings: FindingsSummary | null
  /** V1.7.1b — saudação/abertura/fechamento do que saiu (null fora de READY, no legado e em artefatos anteriores). */
  presentation?: { greeting: string; introduction: string; closing: string; source: "WRITER" | "SYSTEM" } | null
  /** Formato do Output legado (Agent/Orquestrador → Output direto), só quando `kind = LEGACY`. */
  legacy: { impactedIndicator: string; observedBehavior: string; recommendation: string; evidenceFound: string; status: string } | null
  /** Mensagem do motor (só `kind = ENGINE`): o card e a narrativa que saíram, o tom e quantos pontos sustentam; na abstenção, o detalhe do motivo. */
  engine?: { card: string | null; narrative: string[]; tone: string | null; developments: number; strengths: number; abstainDetail: string | null } | null
  /** Emitido ao colaborador (Acompanhamento) — só com efeito persistido. */
  sent: boolean
  emittedAt: string | null
  error: string | null
}

export type OutputDeliveryStatus = "SENT" | "RECORDED_NOT_DELIVERED" | "NOT_EMITTED"
export type ResultOutput = { nodeId: string; nodeLabel: string; surface: string; recipientName: string; status: OutputDeliveryStatus; emittedAt: string | null }

export type ResultAiCall = { nodeId: string | null; nodeLabel: string | null; actor: string | null; useCase: string; useCaseLabel: string; providerKey: string; modelName: string; usage: UsageTotals }

export type PersonResult = {
  enrollmentId: string
  person: { id: string; name: string; teamName: string | null; subteamName: string | null }
  status: EnrollmentStatus
  waitingForQa: boolean
  agents: { nodeId: string; name: string }[]
  /** V1.7.1 — `routing`/`synthesis`: como a coordenação aconteceu (null = não informado, eventos anteriores à V1.7.1). */
  orchestrators: { nodeId: string; name: string; routing: "DETERMINISTIC" | "MODEL" | null; synthesis: "PASSTHROUGH" | "MODEL" | "NONE" | null }[]
  feedbacks: ResultFeedback[]
  outputs: ResultOutput[]
  usage: UsageTotals
  aiCalls: ResultAiCall[]
  durationMs: number | null
  error: string | null
  /** V1.7.1c — detalhe técnico da falha atual (null sem falha ou em eventos anteriores à classificação). */
  failure?: ResultFailure | null
}

export type NameLookup = { agents: ReadonlyMap<string, string>; orchestrators: ReadonlyMap<string, string> }

type GraphNode = FlowGraph["nodes"][number]
const nodeLabel = (graph: FlowGraph | undefined, nodeId: string) => graph?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId

/** Quem agiu num nó: Agent (Chamar agente) ou Orquestrador, pelo nome humano; null para outros nós. */
export function actorOfNode(node: GraphNode | undefined, names: NameLookup): { kind: "AGENT" | "ORCHESTRATOR"; name: string } | null {
  if (!node) return null
  const config = node.config as { actionType?: string; agentId?: string; orchestratorId?: string }
  if (node.type === "action" && config.actionType === "CALL_AGENT" && config.agentId) return { kind: "AGENT", name: names.agents.get(config.agentId) ?? "Agente removido" }
  if (node.type === "orchestrator" && config.orchestratorId) return { kind: "ORCHESTRATOR", name: names.orchestrators.get(config.orchestratorId) ?? "Orquestrador removido" }
  return null
}

export const outputAlertDedupeKey = (enrollmentId: string, nodeId: string, recipientId: string) => `workflow_output:${enrollmentId}:${nodeId}:${recipientId}`

const SENT_FEEDBACK_STATUSES = new Set(["PUBLISHED", "ACKNOWLEDGED"])
const TERMINAL: readonly EnrollmentStatus[] = ["completed", "failed", "dead"]
const FAILURE_EVENTS = new Set(["node_failed", "flow_dead"])

function reliableFeedbackOf(row: ArtifactRow, reviews: readonly ReviewRow[], graph: FlowGraph | undefined, emission: EmissionRow | undefined): ResultFeedback {
  const base = { kind: "RELIABLE" as const, nodeId: row.nodeId, nodeLabel: nodeLabel(graph, row.nodeId), domain: row.domain, legacy: null, findings: null as FindingsSummary | null }
  if (row.status !== "COMPLETED" || !row.artifact) {
    return { ...base, label: null, disposition: row.status === "FAILED" ? "FAILED" : "PENDING", reasons: [], items: [], sent: false, emittedAt: null, error: row.status === "FAILED" ? row.lastError : null }
  }
  const artifact = row.artifact
  const states: ArtifactReviewState[] = reviews.map(({ itemIndex, status, finalWording }) => ({ itemIndex, status, finalWording }))
  const disposition = currentDisposition(artifact, states)
  const reasons = artifact.blockedReason ? [artifact.blockedReason] : [...new Set(artifact.items.flatMap((item) => item.decision.reasons))]
  const facts = (list: readonly ReliableFact[]): ResultFact[] => list.map(({ role, text, truncated }) => ({ role, text, truncated }))
  let items: ResultFeedbackItem[] = []
  let presentation: ResultFeedback["presentation"] = null
  if (disposition === "READY") {
    const emitted = emittedItems(artifact, states)
    const resolved = presentationOf(artifact, emitted)
    presentation = resolved ? { greeting: resolved.greeting, introduction: resolved.introduction, closing: resolved.closing, source: resolved.source } : null
    // O MESMO cálculo do publicador: texto final do QA quando editado, proposto quando aprovado sem mudança/sem QA.
    items = emitted.map((item) => ({ section: item.section, sectionLabel: item.sectionLabel, wording: item.wording, wordingSource: item.wordingSource, qaStatus: item.qaStatus, facts: facts(item.facts), stepTitle: item.process?.stepTitle ?? null, priorityRank: item.priority?.rank ?? null }))
  } else if (disposition === "HOLD_FOR_QA" || disposition === "REJECTED") {
    // Produzido mas não liberado: mostra o que foi proposto (e a decisão do QA, quando houver) — nunca como enviado.
    items = artifact.items.flatMap((item): ResultFeedbackItem[] => {
      if (!item.proposedWording || !isEmittableSection(item.section) || item.decision.disposition === "BLOCKED") return []
      const review = states.find((state) => state.itemIndex === item.index)
      const edited = review?.status === "APPROVED_EDITED" && review.finalWording
      return [{ section: item.section, sectionLabel: SECTION_LABELS[item.section], wording: edited ? review.finalWording! : item.proposedWording, wordingSource: edited ? "HUMAN_EDITED" : "PROPOSED", qaStatus: review?.status ?? "NOT_SELECTED_FOR_QA", facts: facts(item.facts), stepTitle: item.process?.stepTitle ?? null, priorityRank: item.priority?.rank ?? null }]
    })
  }
  const sent = disposition === "READY" && Boolean(emission?.feedbackId)
  return { ...base, label: artifact.label, disposition, reasons, items, findings: findingsSummaryOf(artifact, states), presentation, sent, emittedAt: sent ? emission!.createdAt : null, error: null }
}

function engineFeedbackOf(row: EngineMessageRow, graph: FlowGraph | undefined, emission: EmissionRow | undefined): ResultFeedback {
  const [reason, detail] = row.abstainReason ? [row.abstainReason.split(":")[0]!, row.abstainReason.includes(":") ? row.abstainReason.slice(row.abstainReason.indexOf(":") + 1) : null] : [null, null]
  const disposition: ResultFeedback["disposition"] = row.status === "PUBLISHABLE" ? "READY" : row.status === "ABSTAINED" ? "ABSTAINED" : row.status === "FAILED" ? "FAILED" : "PENDING"
  const sent = disposition === "READY" && Boolean(emission?.feedbackId)
  return {
    kind: "ENGINE", nodeId: row.nodeId, nodeLabel: nodeLabel(graph, row.nodeId), domain: row.domain, label: row.label, disposition, reasons: reason ? [reason] : [], items: [], findings: null, presentation: null, legacy: null,
    engine: { card: row.card, narrative: row.paragraphs ?? [], tone: row.tone, developments: row.developments, strengths: row.strengths, abstainDetail: detail },
    sent, emittedAt: sent ? emission!.createdAt : null, error: row.status === "FAILED" ? row.error : null,
  }
}

export type PersonInputs = {
  graphs: ReadonlyMap<string, FlowGraph>
  names: NameLookup
  events: readonly EventRow[]
  artifacts: readonly ArtifactRow[]
  reviews: readonly ReviewRow[]
  emissions: readonly EmissionRow[]
  alerts: readonly AlertRow[]
  surfaceRows: readonly SurfaceRow[]
  legacyFeedbacks: readonly LegacyFeedbackRow[]
  engineMessages?: readonly EngineMessageRow[]
  usage: readonly UsageGroupRow[]
}

/** Resultado de UMA pessoa do disparo a partir das linhas já carregadas em lote. */
export function assemblePersonResult(person: PersonEnrollmentRow, inputs: PersonInputs): PersonResult {
  const graph = inputs.graphs.get(person.versionId)
  const events = inputs.events.filter((event) => event.enrollmentId === person.enrollmentId)
  const artifacts = inputs.artifacts.filter((row) => row.enrollmentId === person.enrollmentId)
  const emissions = inputs.emissions.filter((row) => row.enrollmentId === person.enrollmentId)
  const alertKeys = new Map(inputs.alerts.map((alert) => [alert.dedupeKey, alert]))

  // Feedback confiável (um por nó "Gerar feedback") + feedback do Output legado (Agent/Orquestrador → Output direto).
  const reliable = artifacts.map((row) => {
    const emission = emissions.find((entry) => entry.artifactId === row.id && entry.surface === "FOLLOW_UP" && entry.recipientId === person.subjectId)
    return reliableFeedbackOf(row, inputs.reviews.filter((review) => review.artifactId === row.id), graph, emission)
  })
  const engine = (inputs.engineMessages ?? []).filter((row) => row.enrollmentId === person.enrollmentId).map((row) => {
    const emission = emissions.find((entry) => entry.engineMessageId === row.id && entry.surface === "FOLLOW_UP" && entry.recipientId === person.subjectId)
    return engineFeedbackOf(row, graph, emission)
  })
  const reliableFeedbackIds = new Set(emissions.map((entry) => entry.feedbackId).filter(Boolean))
  const legacy = inputs.legacyFeedbacks
    .filter((row) => row.enrollmentId === person.enrollmentId && !reliableFeedbackIds.has(row.feedbackId))
    .map((row): ResultFeedback => {
      const sent = SENT_FEEDBACK_STATUSES.has(row.status)
      return {
        kind: "LEGACY", nodeId: row.nodeId, nodeLabel: nodeLabel(graph, row.nodeId), domain: null, label: row.impactedIndicator, disposition: "PUBLISHED", reasons: [], items: [], findings: null,
        legacy: { impactedIndicator: row.impactedIndicator, observedBehavior: row.observedBehavior, recommendation: row.recommendation, evidenceFound: row.evidenceFound, status: row.status },
        sent, emittedAt: sent ? row.publishedAt : null, error: null,
      }
    })

  // Outputs: cada (nó Output executado × superfície × destinatário pedido) com o EFEITO persistido correspondente.
  const outputs: ResultOutput[] = []
  const seen = new Set<string>()
  for (const event of events.filter((entry) => entry.eventType === "output_dispatched")) {
    for (const surface of event.surfaces ?? []) {
      for (const recipient of event.recipients ?? []) {
        const key = `${event.nodeId}|${surface}|${recipient.id}`
        if (seen.has(key)) continue
        seen.add(key)
        let status: OutputDeliveryStatus = "NOT_EMITTED"
        let emittedAt: string | null = null
        const emission = emissions.find((entry) => entry.nodeId === event.nodeId && entry.surface === surface && entry.recipientId === recipient.id && entry.feedbackId)
        const legacyFeedback = inputs.legacyFeedbacks.find((row) => row.enrollmentId === person.enrollmentId && row.nodeId === event.nodeId)
        if (surface === "FOLLOW_UP" && recipient.id === person.subjectId && emission) {
          status = "SENT"
          emittedAt = emission.createdAt
        } else if (surface === "FOLLOW_UP" && recipient.id === person.subjectId && legacyFeedback) {
          status = SENT_FEEDBACK_STATUSES.has(legacyFeedback.status) ? "SENT" : "RECORDED_NOT_DELIVERED"
          emittedAt = legacyFeedback.publishedAt
        } else if (surface === "FOLLOW_UP" || surface === "NOTIFICATION") {
          const alert = alertKeys.get(outputAlertDedupeKey(person.enrollmentId, event.nodeId, recipient.id))
          if (alert) {
            status = "SENT"
            emittedAt = alert.createdAt
          }
        } else {
          const row = inputs.surfaceRows.find((entry) => entry.enrollmentId === person.enrollmentId && entry.nodeId === event.nodeId && entry.surface === surface && entry.recipientId === recipient.id)
          if (row) {
            status = row.deliveredAt ? "SENT" : "RECORDED_NOT_DELIVERED"
            emittedAt = row.deliveredAt ?? row.createdAt
          }
        }
        outputs.push({ nodeId: event.nodeId, nodeLabel: nodeLabel(graph, event.nodeId), surface, recipientName: recipient.name, status, emittedAt })
      }
    }
  }

  // Quem agiu: nós Agent/Orquestrador executados (evento) ou que consumiram IA (uso correlacionado).
  const usage = inputs.usage.filter((row) => row.enrollmentId === person.enrollmentId)
  const actedNodeIds = [...new Set([
    ...events.filter((event) => (event.eventType === "action_executed" && event.actionType === "CALL_AGENT") || event.eventType === "orchestrator_executed").map((event) => event.nodeId),
    ...usage.map((row) => row.nodeId).filter((nodeId): nodeId is string => Boolean(nodeId)),
  ])]
  const agents: PersonResult["agents"] = []
  const orchestrators: PersonResult["orchestrators"] = []
  for (const nodeId of actedNodeIds) {
    const actor = actorOfNode(graph?.nodes.find((node) => node.id === nodeId), inputs.names)
    if (actor?.kind === "AGENT") agents.push({ nodeId, name: actor.name })
    if (actor?.kind === "ORCHESTRATOR") {
      const executed = [...events].reverse().find((event) => event.eventType === "orchestrator_executed" && event.nodeId === nodeId)
      const routing = executed?.routingMode === "DETERMINISTIC" || executed?.routingMode === "MODEL" ? executed.routingMode : null
      const synthesis = executed?.synthesisMode === "PASSTHROUGH" || executed?.synthesisMode === "MODEL" || executed?.synthesisMode === "NONE" ? executed.synthesisMode : null
      orchestrators.push({ nodeId, name: actor.name, routing, synthesis })
    }
  }

  const aiCalls: ResultAiCall[] = usage.map((row) => ({
    nodeId: row.nodeId,
    nodeLabel: row.nodeId ? nodeLabel(graph, row.nodeId) : null,
    actor: actorOfNode(graph?.nodes.find((node) => node.id === row.nodeId), inputs.names)?.name ?? null,
    useCase: row.useCase,
    useCaseLabel: row.useCaseLabel,
    providerKey: row.providerKey,
    modelName: row.modelName,
    usage: row.usage,
  }))

  // Erro real da trilha: o ÚLTIMO evento da matrícula é uma falha (retry pendente ou execução morta) — uma falha antiga já
  // superada por um nó posterior não é mostrada como erro atual.
  const lastEvent = events[events.length - 1]
  const failure = lastEvent && FAILURE_EVENTS.has(lastEvent.eventType) ? lastEvent : null
  const terminal = TERMINAL.includes(person.status)
  return {
    enrollmentId: person.enrollmentId,
    person: { id: person.subjectId, name: person.subjectName, teamName: person.teamName, subteamName: person.subteamName },
    status: person.status,
    waitingForQa: person.status === "waiting" && reliable.some((feedback) => feedback.disposition === "HOLD_FOR_QA" && feedback.nodeId === person.currentNodeId),
    agents,
    orchestrators,
    feedbacks: [...engine, ...reliable, ...legacy],
    outputs,
    usage: sumUsage(usage.map((row) => row.usage)),
    aiCalls,
    durationMs: terminal ? Math.max(0, new Date(person.updatedAt).getTime() - new Date(person.createdAt).getTime()) : null,
    error: failure?.message ?? null,
    failure: resultFailureOf(failure?.failure),
  }
}
