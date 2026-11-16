import { CLASSIFICATION_REASON_LABELS, UNFINISHED_ATTENDANCE_END_CAUSES, type AttendanceEndCause, type ClassificationReason, type LostCause, type Pertinence, type RequestEndCause, type RequestStatus } from "./catalogs.js"
import { MIN_SAMPLE, ratio, type Ratio } from "./metrics-definitions.js"

/**
 * INDICADORES DE ATENDIMENTO POR ANJO E DA OPERAÇÃO (migration 191; pedido do responsável em 2026-11-11). Funções puras sobre os
 * registros do servidor (atendimentos, pedidos, classificações, mensagens). A atribuição é DIRETA (D2, mantida em 11/11): o
 * acolhimento é a atribuição — não existe oferta, aceite nem oferta expirada; "tempo de acolhimento" não se aplica e o tempo até a
 * primeira resposta do Anjo mede a demora real. Regras:
 *  - espera do operador: da ENTRADA ORIGINAL do pedido (`created_at`) ao PRIMEIRO acolhimento, só dos pedidos acolhidos; conta para o
 *    Anjo que acolheu primeiro;
 *  - tempo de atendimento: do acolhimento ao encerramento, dos atendimentos encerrados do Anjo; concluídos normalmente (encerrados pelo
 *    Anjo ou pelo operador) separados dos encerrados por outros motivos;
 *  - motivos: as classificações dos atendimentos concluídos (fora interrompidos e transferidos, que ninguém classifica); sem
 *    classificação = "Sem classificação";
 *  - pertinência: taxa = Pertinente ÷ (Pertinente + Não pertinente); classificação anterior à 191 = Não avaliado;
 *  - falta de retorno: atendimentos encerrados por inatividade ÷ atendimentos encerrados do Anjo (fora os transferidos pela
 *    coordenação), e de quem faltou o retorno — do Anjo (nunca respondeu, ou a última mensagem humana foi do operador) ou do operador
 *    (a última foi do Anjo);
 *  - abandono depois do acolhimento: atendimento encerrado porque o operador fechou a INIA (`OPERATOR_ABSENT`), atribuído ao Anjo;
 *  - interrupções pelo sistema por causa: rede, sessão encerrada, papel retirado (anteriores à 191 = sem causa registrada).
 * Médias sempre com a quantidade considerada; quantidade zero = média nula ("sem dados"), nunca zero.
 */
export type AttendanceRecord = {
  anjoPersonId: string
  requestId: string
  startedAt: number
  endedAt: number | null
  endCause: AttendanceEndCause | null
  lostCause: LostCause | null
  firstAnjoMessageAt: number | null
  /** Autor da última mensagem humana do atendimento (null = nenhuma). */
  lastHumanAuthor: "ANJO" | "OPERATOR" | null
  classification: { reason: ClassificationReason; pertinence: Pertinence | null } | null
  /** Estrelas da avaliação vigente do operador para este atendimento (null = sem nota). */
  stars?: number | null
  /** Este é o primeiro atendimento do pedido (o acolhimento que encerra a espera do operador). */
  firstOfRequest: boolean
  requestCreatedAt: number
}

export type RequestRecord = {
  status: RequestStatus
  endCause: RequestEndCause | null
  hadAttendance: boolean
  /** Anjos em serviço quando saiu da fila sem atendimento; null = não registrado (anterior à 191) ou não se aplica. */
  anjosInServiceAtEnd: number | null
}

export type Average = { averageSeconds: number | null; count: number }
const average = (seconds: readonly number[]): Average => ({ averageSeconds: seconds.length === 0 ? null : seconds.reduce((sum, value) => sum + value, 0) / seconds.length, count: seconds.length })

export const NORMAL_END_CAUSES: readonly AttendanceEndCause[] = ["ANJO_CLOSED", "OPERATOR_CLOSED"]
export const NO_CLASSIFICATION = "NO_CLASSIFICATION" as const

export type AttendanceIndicators = {
  acolhimentos: number
  operatorWait: Average
  firstResponse: Average
  handling: Average & { normal: Average; other: Average; otherByCause: Partial<Record<AttendanceEndCause, number>> }
  reasons: { total: number; items: { key: ClassificationReason | typeof NO_CLASSIFICATION; label: string; count: number; share: number | null }[] }
  pertinence: { pertinent: number; notPertinent: number; notEvaluated: number; rate: Ratio }
  noReply: { rate: Ratio; anjoSide: number; operatorSide: number }
  abandonedAfterAcolhimento: number
  interruptedBySystem: { connection: number; session: number; roleRevoked: number; unknown: number }
  /** Média das estrelas do operador — só com 5 notas ou mais (abaixo disso, nula); `count` = notas consideradas. */
  stars: { average: number | null; count: number }
}

const seconds = (from: number, to: number) => (to - from) / 1000

function starsOf(records: readonly AttendanceRecord[]) {
  const stars = records.flatMap((record) => (record.stars == null ? [] : [record.stars]))
  return { average: stars.length >= MIN_SAMPLE ? Math.round((stars.reduce((sum, value) => sum + value, 0) / stars.length) * 100) / 100 : null, count: stars.length }
}

export function attendanceIndicators(records: readonly AttendanceRecord[]): AttendanceIndicators {
  const ended = records.filter((record) => record.endedAt !== null && record.endCause !== null)
  const concluded = ended.filter((record) => !UNFINISHED_ATTENDANCE_END_CAUSES.includes(record.endCause!))
  const reasonCounts = new Map<string, number>()
  for (const record of concluded) {
    const key = record.classification?.reason ?? NO_CLASSIFICATION
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1)
  }
  const reasonItems = [...reasonCounts.entries()]
    .map(([key, count]) => ({ key: key as ClassificationReason | typeof NO_CLASSIFICATION, label: key === NO_CLASSIFICATION ? "Sem classificação" : CLASSIFICATION_REASON_LABELS[key as ClassificationReason], count, share: concluded.length > 0 ? count / concluded.length : null }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
  const classified = concluded.flatMap((record) => (record.classification ? [record.classification] : []))
  const pertinent = classified.filter((item) => item.pertinence === "PERTINENT").length
  const notPertinent = classified.filter((item) => item.pertinence === "NOT_PERTINENT").length
  const noReplyBase = ended.filter((record) => record.endCause !== "TRANSFERRED")
  const inactive = noReplyBase.filter((record) => record.endCause === "INACTIVITY")
  const anjoSide = inactive.filter((record) => record.firstAnjoMessageAt === null || record.lastHumanAuthor !== "ANJO").length
  const otherByCause: Partial<Record<AttendanceEndCause, number>> = {}
  for (const record of ended) if (!NORMAL_END_CAUSES.includes(record.endCause!)) otherByCause[record.endCause!] = (otherByCause[record.endCause!] ?? 0) + 1
  const lost = ended.filter((record) => record.endCause === "ANJO_LOST")
  return {
    acolhimentos: records.length,
    operatorWait: average(records.filter((record) => record.firstOfRequest).map((record) => seconds(record.requestCreatedAt, record.startedAt))),
    firstResponse: average(records.flatMap((record) => (record.firstAnjoMessageAt === null ? [] : [seconds(record.startedAt, record.firstAnjoMessageAt)]))),
    handling: {
      ...average(ended.map((record) => seconds(record.startedAt, record.endedAt!))),
      normal: average(ended.filter((record) => NORMAL_END_CAUSES.includes(record.endCause!)).map((record) => seconds(record.startedAt, record.endedAt!))),
      other: average(ended.filter((record) => !NORMAL_END_CAUSES.includes(record.endCause!)).map((record) => seconds(record.startedAt, record.endedAt!))),
      otherByCause,
    },
    reasons: { total: concluded.length, items: reasonItems },
    pertinence: { pertinent, notPertinent, notEvaluated: concluded.length - pertinent - notPertinent, rate: ratio(pertinent, pertinent + notPertinent) },
    noReply: { rate: ratio(inactive.length, noReplyBase.length), anjoSide, operatorSide: inactive.length - anjoSide },
    abandonedAfterAcolhimento: ended.filter((record) => record.endCause === "OPERATOR_ABSENT").length,
    stars: starsOf(records),
    interruptedBySystem: {
      connection: lost.filter((record) => record.lostCause === "CONNECTION").length,
      session: lost.filter((record) => record.lostCause === "SESSION").length,
      roleRevoked: lost.filter((record) => record.lostCause === "ROLE_REVOKED").length,
      unknown: lost.filter((record) => record.lostCause === null).length,
    },
  }
}

/**
 * Da OPERAÇÃO, sem atribuição individual, pelos pedidos criados no período:
 *  - sem Anjo logado: pedidos encerrados na fila SEM nenhum acolhimento quando não havia Anjo em serviço no escopo (contados uma vez;
 *    os anteriores à 191 ficam em "sem registro"); pedido ainda na fila não entra;
 *  - abandono antes do acolhimento: pedidos sem nenhum acolhimento que o operador cancelou ou deixou (fechou a INIA);
 *  - pedidos que voltaram à fila depois de acolhidos (interrupção ou devolução) e terminaram sem novo acolhimento, à parte.
 */
export function operationIndicators(requests: readonly RequestRecord[]) {
  const endedInQueue = requests.filter((request) => !request.hadAttendance && request.endCause !== null && ["CANCELLED", "EXPIRED", "ABANDONED"].includes(request.status))
  return {
    requests: requests.length,
    acolhidos: requests.filter((request) => request.hadAttendance).length,
    waiting: requests.filter((request) => request.status === "WAITING").length,
    inProgress: requests.filter((request) => request.status === "IN_PROGRESS").length,
    endedWithoutAcolhimento: endedInQueue.length,
    noAnjoLogged: { count: endedInQueue.filter((request) => request.anjosInServiceAtEnd === 0).length, withAnjos: endedInQueue.filter((request) => (request.anjosInServiceAtEnd ?? 0) > 0).length, unrecorded: endedInQueue.filter((request) => request.anjosInServiceAtEnd === null).length },
    abandonedBeforeAcolhimento: {
      abandoned: endedInQueue.filter((request) => request.endCause === "OPERATOR_ABANDONED").length,
      cancelled: endedInQueue.filter((request) => request.endCause === "OPERATOR_CANCELLED").length,
    },
    expired: endedInQueue.filter((request) => request.endCause === "QUEUE_EXPIRED").length,
    endedInQueueAfterAcolhimento: requests.filter((request) => request.hadAttendance && ["CANCELLED", "EXPIRED", "ABANDONED"].includes(request.status)).length,
  }
}
export type OperationIndicators = ReturnType<typeof operationIndicators>
