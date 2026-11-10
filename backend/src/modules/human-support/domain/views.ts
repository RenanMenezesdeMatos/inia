import type { ChatDislikeReason } from "../../assistant/domain/assistant-interaction-rating.js"
import type { AvailabilityStatus } from "./availability.js"
import type { AttendanceEndCause, ClassificationOutcome, ClassificationReason, EvaluationResolved, PauseReason, PresenceStatus, RequestEndCause, RequestOrigin, RequestStatus, SystemMessageCode } from "./catalogs.js"
import type { EffectiveSource, ScopeState } from "./enablement.js"
import type { Receipts } from "./conversation-marks.js"
import type { WaitEstimate } from "./queue-history.js"

/**
 * CONTRATOS DE RESPOSTA do Apoio com Anjo (design_draft.md, Apêndice C). O espelho do frontend fica em
 * `frontend/src/schemas/human-support/*.schema.ts` (tipos por `z.infer`). A visão do OPERADOR nunca tem campo de presença ou pausa
 * de Anjo (conferido na prova `testing/human-support-proof.test.ts`, com Anjos em pausa).
 */
export type Availability = { status: AvailabilityStatus; estimate: WaitEstimate | null; queueDeadline: string | null }

/** A cópia da troca que o Anjo recebe: exatamente o que o operador viu na prévia. */
export type SharedContext = { question: string | null; answer: string | null; dislike: { reason: ChatDislikeReason; reasonLabel: string; comment: string | null } | null; note: string | null }

export type MessageView = { id: string; seq: number; authorKind: "OPERATOR" | "ANJO" | "SYSTEM"; authorName: string | null; body: string; systemCode: SystemMessageCode | null; occurredAt: string }

export type OperatorRequestView = {
  id: string
  protocol: string
  status: RequestStatus
  endCause: RequestEndCause | null
  origin: RequestOrigin
  createdAt: string
  queuedAt: string
  queueExpiresAt: string | null
  sharedContext: SharedContext
  anjo: { name: string; avatarUrl: string | null; awaitingFirstResponse: boolean } | null
  messages: MessageView[]
  hasOlder: boolean
  canCancel: boolean
  canClose: boolean
  /** Até onde o lado do Anjo recebeu (entregue) e viu (lida) as mensagens deste pedido — os tiques das mensagens do operador. */
  peerReceipts: Receipts
  /** Por quantos ms ainda vale o "digitando" do Anjo (null = não está digitando). */
  peerTypingMs: number | null
}

export type PendingEvaluation = { attendanceId: string; requestId: string; protocol: string; anjoName: string; openUntil: string; current: { resolved: EvaluationResolved | null; stars: number | null } }

export type OperatorView = { enabled: boolean; availability: Availability | null; openRequest: OperatorRequestView | null; pendingEvaluations: PendingEvaluation[] }

export type AnjoAttendanceView = {
  id: string
  requestId: string
  protocol: string
  operatorName: string
  teamName: string | null
  subteamName: string | null
  startedAt: string
  firstAnjoMessageAt: string | null
  lastSeq: number
  /** Desde quando o operador não chama o servidor (null = presente nos últimos 5 min): habilita "operador sem a INIA aberta". */
  operatorAbsentSince: string | null
  sharedContext: SharedContext
  /** Até onde o operador recebeu (entregue) e viu (lida) as mensagens — os tiques das mensagens do Anjo. */
  peerReceipts: Receipts
  /** Por quantos ms ainda vale o "digitando" do operador (null = não está digitando). */
  peerTypingMs: number | null
}

export type AnjoView = {
  /** Instante do servidor ao montar a resposta: a tela corrige o próprio relógio para contar "há quanto tempo" sem diferença de fuso ou de hora. */
  serverTime: string
  presence: { status: PresenceStatus; pauseReason: PauseReason | null; connected: boolean; since: string }
  capacity: { max: number; used: number }
  attendances: AnjoAttendanceView[]
  /** Atendimentos encerrados sem classificação; `startedAt`/`endedAt` = início e fim reais do atendimento (a duração final, congelada). */
  pendingClassifications: { attendanceId: string; protocol: string; operatorName: string; startedAt: string; endedAt: string; endCause: AttendanceEndCause }[]
}

export type StateResponse = { version: string; reconnect?: true; operator: OperatorView | null; anjo: AnjoView | null }

export type PreviewResponse = { origin: RequestOrigin; interactionId: string | null; ratingId: string | null; sharedContext: SharedContext; availability: Availability }

export type MyRequestItem = { id: string; protocol: string; status: RequestStatus; origin: RequestOrigin; createdAt: string; endedAt: string | null; anjoName: string | null; evaluation: PendingEvaluation["current"] | null; evaluationOpenUntil: string | null }

/** Classificação resumida no histórico do próprio Anjo: o motivo, o resultado e a ferramenta/processo informados (sem o link e a descrição). */
export type AttendanceClassificationSummary = { reason: ClassificationReason; outcome: ClassificationOutcome; referenceTitle: string | null }

export type AnjoAttendanceHistoryItem = {
  attendanceId: string
  requestId: string
  protocol: string
  operatorName: string
  startedAt: string
  firstAnjoMessageAt: string | null
  endedAt: string | null
  endCause: AttendanceEndCause | null
  classified: boolean
  /** null = ainda sem classificação (ou atendimento em andamento). */
  classification: AttendanceClassificationSummary | null
}

export type ClassificationView = { reason: ClassificationReason; referenceTitle: string | null; referenceUrl: string | null; otherDescription: string | null; outcome: ClassificationOutcome }

// Administrador geral
export type SettingsView = { enabled: boolean; defaultCapacity: number; version: number }
export type ScopeNode = { type: "GROUP" | "SUBGROUP"; id: string; name: string; state: ScopeState; effective: boolean; effectiveSource: EffectiveSource; anjoCount: number; warnings: "ENABLED_WITHOUT_ANJO"[]; children?: ScopeNode[] }
export type AnjoScopeView = { type: "ORGANIZATION" | "GROUP" | "SUBGROUP"; id: string | null; name: string }
export type AnjoRow = {
  personId: string
  name: string
  scopes: AnjoScopeView[]
  maxConcurrent: number | null
  effectiveCapacity: number
  status: PresenceStatus
  connected: boolean
  used: number
  canReceiveAssignment: boolean | null
  reasonNotEligible: "OFFLINE" | "PAUSED" | "NO_CAPACITY" | "NOT_CONNECTED" | "SCOPE_NOT_COVERED" | null
}

// Painel do apoio
export type RequestListItem = {
  id: string
  protocol: string
  operatorName: string
  teamName: string | null
  subteamName: string | null
  origin: RequestOrigin
  status: RequestStatus
  endCause: RequestEndCause | null
  createdAt: string
  endedAt: string | null
  anjoNames: string[]
  firstResponseSeconds: number | null
  classificationReason: ClassificationReason | null
  outcome: ClassificationOutcome | null
  resolved: EvaluationResolved | null
  stars: number | null
}
export type RequestDetail = RequestListItem & {
  sharedContext: SharedContext
  messages: MessageView[]
  attendances: { id: string; anjoName: string; startedAt: string; firstAnjoMessageAt: string | null; endedAt: string | null; endCause: AttendanceEndCause | null }[]
  classification: ClassificationView | null
}
export type UnavailableAttempt = { occurredAt: string; personName: string; teamName: string | null; subteamName: string | null; origin: RequestOrigin | null }
export type AnjoActivity = {
  personId: string
  name: string
  hoursAvailable: number
  hoursPaused: Record<PauseReason, number>
  hoursDisconnected: number
  attendances: number
  firstResponse: { p50Seconds: number | null; p90Seconds: number | null; withoutResponse: number }
  /** Média das estrelas recebidas — só com 5 notas ou mais (o Anjo não vê as próprias notas, OQ2). */
  averageStars: number | null
}
/** Situação de um Anjo AGORA (aba Anjos do painel): cadastral (ativo/inativo) separada do status operacional. */
export type AnjoNowItem = {
  personId: string
  name: string
  scopes: AnjoScopeView[]
  /** Pessoa ativa e conta ativa com acesso liberado. */
  active: boolean
  status: "AVAILABLE" | "IN_ATTENDANCE" | "PAUSED" | "UNAVAILABLE"
  pauseReason: PauseReason | null
  /** Desde quando está no status mostrado (transição real); null = Indisponível (sem contador). */
  since: string | null
  /** A área do Anjo está aberta agora (Disponível/Em pausa sem conexão = não recebe atendimento). */
  connected: boolean
  connectionLostSince: string | null
  attendances: { active: number; capacity: number }
}
export type AnjosNow = { serverTime: string; items: AnjoNowItem[] }
export type PresenceTimeline = { events: { occurredAt: string; fromStatus: PresenceStatus | null; toStatus: PresenceStatus; pauseReason: PauseReason | null; cause: string }[] }
