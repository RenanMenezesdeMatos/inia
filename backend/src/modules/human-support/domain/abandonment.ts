import type { AttendanceEndCause, LostCause, RequestEndCause, RequestStatus } from "./catalogs.js"
import { ratio, type Ratio } from "./metrics-definitions.js"

/**
 * ABANDONOS (pedido do responsável em 2026-11-12): o mesmo cálculo na Monitoria Online (hoje, ao vivo) e em Indicadores (período).
 * Encerramento NORMAL — pelo Anjo ou pelo operador — nunca é abandono; transferência pela coordenação também não.
 *
 *  - NA ESPERA (pedidos que entraram na fila no recorte): o operador abandonou = fechou a INIA sem ser atendido (`OPERATOR_ABANDONED`)
 *    ou cancelou (`OPERATOR_CANCELLED`). Expirado (`QUEUE_EXPIRED`: ninguém atendeu a tempo) vem à parte — quem encerra é o sistema.
 *    Taxa = abandonos ÷ pedidos do recorte.
 *  - NO ATENDIMENTO (atendimentos acolhidos no recorte e já encerrados, fora os transferidos): pelo OPERADOR = saiu da INIA no meio
 *    (`OPERATOR_ABSENT`) ou parou de responder (`OPERATOR_SILENT`: o tempo configurado venceu com a última mensagem do Anjo — o Anjo
 *    foi liberado e o pedido passou a aguardar o operador); pelo ANJO = saiu e derrubou o operador (`ANJO_LOST` com a SESSÃO encerrada:
 *    deslogou, prazo do login, conta desligada) ou parou de responder (`ANJO_SILENT`: o tempo configurado venceu sem resposta dele ou com a última mensagem do operador — o pedido
 *    voltou à fila). Queda de REDE, papel retirado pela coordenação e queda sem causa registrada (anteriores à 191) NÃO são abandono do
 *    Anjo (decisão do responsável em 2026-11-16): aparecem à parte, sem entrar no total nem na taxa. Antes da migration 193 os dois "parou de responder" eram um só `INACTIVITY`, separado aqui pela última mensagem.
 *    Taxa = abandonos ÷ atendimentos encerrados do recorte — no total e SEPARADA por lado (do operador; do Anjo), para que o abandono do
 *    Anjo tenha um número próprio (pedido do responsável em 2026-11-16).
 */
export type AbandonRequest = { status: RequestStatus; endCause: RequestEndCause | null }
export type AbandonAttendance = { endCause: AttendanceEndCause | null; lostCause: LostCause | null; anjoResponded: boolean; lastHumanAuthor: "ANJO" | "OPERATOR" | null }

export type Abandonment = {
  waiting: { requests: number; closedInia: number; cancelled: number; abandoned: number; rate: Ratio; expired: number }
  attendance: {
    ended: number
    byOperator: { leftInia: number; noReply: number; total: number; rate: Ratio }
    byAnjo: { connection: number; session: number; roleRevoked: number; unknownDrop: number; noReply: number; total: number; rate: Ratio }
    abandoned: number
    rate: Ratio
  }
}

export function abandonmentOf(requests: readonly AbandonRequest[], attendances: readonly AbandonAttendance[]): Abandonment {
  const closedInia = requests.filter((request) => request.endCause === "OPERATOR_ABANDONED").length
  const cancelled = requests.filter((request) => request.endCause === "OPERATOR_CANCELLED").length
  const ended = attendances.filter((attendance) => attendance.endCause !== null && attendance.endCause !== "TRANSFERRED")
  const inactive = ended.filter((attendance) => attendance.endCause === "INACTIVITY")
  // De quem faltou o retorno: do Anjo se ele nunca respondeu ou se a última mensagem humana foi do operador; senão, do operador.
  const legacyAnjoSilent = inactive.filter((attendance) => !attendance.anjoResponded || attendance.lastHumanAuthor !== "ANJO").length
  const anjoSilent = legacyAnjoSilent + ended.filter((attendance) => attendance.endCause === "ANJO_SILENT").length
  const operatorSilent = inactive.length - legacyAnjoSilent + ended.filter((attendance) => attendance.endCause === "OPERATOR_SILENT").length
  const lost = ended.filter((attendance) => attendance.endCause === "ANJO_LOST")
  const leftInia = ended.filter((attendance) => attendance.endCause === "OPERATOR_ABSENT").length
  const byOperator = { leftInia, noReply: operatorSilent, total: leftInia + operatorSilent, rate: ratio(leftInia + operatorSilent, ended.length) }
  const byAnjo = {
    connection: lost.filter((attendance) => attendance.lostCause === "CONNECTION").length,
    session: lost.filter((attendance) => attendance.lostCause === "SESSION").length,
    roleRevoked: lost.filter((attendance) => attendance.lostCause === "ROLE_REVOKED").length,
    unknownDrop: lost.filter((attendance) => attendance.lostCause === null).length,
    noReply: anjoSilent,
    total: lost.filter((attendance) => attendance.lostCause === "SESSION").length + anjoSilent,
    rate: ratio(lost.filter((attendance) => attendance.lostCause === "SESSION").length + anjoSilent, ended.length),
  }
  const abandoned = byOperator.total + byAnjo.total
  return {
    waiting: { requests: requests.length, closedInia, cancelled, abandoned: closedInia + cancelled, rate: ratio(closedInia + cancelled, requests.length), expired: requests.filter((request) => request.endCause === "QUEUE_EXPIRED").length },
    attendance: { ended: ended.length, byOperator, byAnjo, abandoned, rate: ratio(abandoned, ended.length) },
  }
}
