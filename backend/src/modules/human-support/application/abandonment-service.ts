import { abandonmentOf, attendanceAbandonOf, waitingAbandonReason, type AbandonAttendance, type Abandonment, type AbandonmentKind, type AbandonmentReason, type AbandonRequest } from "../domain/abandonment.js"
import type { AttendanceEndCause, LostCause, RequestEndCause, RequestStatus } from "../domain/catalogs.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { assertPanelPeriod, coordinatorScopesOf, coverageClause, periodBounds } from "./coverage.js"
import type { Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"

/**
 * ABANDONOS (regra em `domain/abandonment.ts`) no alcance de quem lê (Coordenador de Anjos e Administrador geral) e no filtro de
 * Grupo/Subgrupo: pedidos que ENTRARAM na fila no recorte e atendimentos ACOLHIDOS no recorte, pelo dia civil da organização. A
 * Monitoria Online pede o dia de hoje; Indicadores, o período escolhido.
 *
 * Os números (`supportAbandonment`) e a lista de QUEM abandonou (`supportAbandonmentList`) leem a MESMA coorte (`loadCohort`: mesmo
 * alcance, período e filtro) e classificam cada registro com as MESMAS funções do domínio — a lista de um card tem sempre o total do
 * card (pedido do responsável em 2026-11-17).
 */
export type AbandonmentQuery = { from: string; to: string; teamId?: readonly string[] | undefined; subteamId?: readonly string[] | undefined }

type RequestRow = { id: string; status: RequestStatus; end_cause: RequestEndCause | null }
type AttendanceRow = { id: string; end_cause: AttendanceEndCause | null; lost_cause: LostCause | null; responded: boolean; last_author: "ANJO" | "OPERATOR" | null }

const asRequest = (row: RequestRow): AbandonRequest => ({ status: row.status, endCause: row.end_cause })
const asAttendance = (row: AttendanceRow): AbandonAttendance => ({ endCause: row.end_cause, lostCause: row.lost_cause, anjoResponded: row.responded, lastHumanAuthor: row.last_author })

async function loadCohort(db: Queryable, viewer: Viewer, query: AbandonmentQuery, parts: { requests: boolean; attendances: boolean }) {
  assertPanelPeriod(query)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const params: unknown[] = [viewer.organizationId, query.from, query.to]
  const bounds = periodBounds("$1", "$2", "$3")
  const where = coverageClause(coverage, "r", params, { teamId: query.teamId, subteamId: query.subteamId }, "operator_person_id")
  const [requests, attendances] = await Promise.all([
    parts.requests
      ? db.query<RequestRow>(`select r.id, r.status, r.end_cause from human_support_requests r where r.organization_id = $1 and r.created_at >= ${bounds.start} and r.created_at < ${bounds.end} and ${where}`, params)
      : null,
    parts.attendances
      ? db.query<AttendanceRow>(
          `select a.id, a.end_cause, a.lost_cause, a.first_anjo_message_at is not null responded,
                  (select m.author_kind from human_support_messages m where m.request_id = a.request_id and m.attendance_id = a.id and m.author_kind in ('ANJO', 'OPERATOR') order by m.seq desc limit 1) last_author
             from human_support_attendances a join human_support_requests r on r.id = a.request_id
            where a.organization_id = $1 and a.started_at >= ${bounds.start} and a.started_at < ${bounds.end} and ${where}`,
          params,
        )
      : null,
  ])
  return { requests: requests?.rows ?? [], attendances: attendances?.rows ?? [] }
}

export async function supportAbandonment(db: Queryable, viewer: Viewer, query: AbandonmentQuery): Promise<Abandonment & { period: { from: string; to: string } }> {
  const cohort = await loadCohort(db, viewer, query, { requests: true, attendances: true })
  return { period: { from: query.from, to: query.to }, ...abandonmentOf(cohort.requests.map(asRequest), cohort.attendances.map(asAttendance)) }
}

export const ABANDONMENT_LIST_PAGE_SIZES = [10, 20, 50] as const
export type AbandonmentListQuery = AbandonmentQuery & { kind: AbandonmentKind; page?: number | undefined; pageSize?: number | undefined }
type PersonRef = { personId: string; name: string; avatarUrl: string | null }
export type AbandonmentListItem = {
  /** Quando o abandono aconteceu (fim do pedido, na espera; fim do atendimento, no atendimento). */
  at: string
  reason: AbandonmentReason
  /** Quem abandonou: o operador (na espera e do operador) ou o Anjo (do Anjo). */
  person: PersonRef
  /** O outro lado do atendimento (o operador, se quem abandonou foi o Anjo; o Anjo, se foi o operador); null na espera. */
  counterpart: PersonRef | null
  /** Pedido de origem (abre a conversa no painel) e, no atendimento, quando o Anjo acolheu. */
  request: { id: string; protocol: string; createdAt: string; teamName: string | null; subteamName: string | null }
  attendanceStartedAt: string | null
}
export type AbandonmentList = { kind: AbandonmentKind; total: number; page: number; pageSize: number; items: AbandonmentListItem[] }

/**
 * QUEM ABANDONOU em cada número do bloco: a coorte do card classificada pelo domínio, mais recentes primeiro, uma página por vez
 * (10/20/50). Só os ids da página buscam nomes, protocolo e Grupo. O nome do Anjo aparece como no detalhe do pedido (o pedido está no
 * alcance de quem lê).
 */
export async function supportAbandonmentList(db: Queryable, viewer: Viewer, query: AbandonmentListQuery): Promise<AbandonmentList> {
  const pageSize = ABANDONMENT_LIST_PAGE_SIZES.includes(query.pageSize as 10) ? query.pageSize! : 20
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const waiting = query.kind === "WAITING"
  const cohort = await loadCohort(db, viewer, query, { requests: waiting, attendances: !waiting })
  const matches: { id: string; reason: AbandonmentReason }[] = waiting
    ? cohort.requests.flatMap((row) => {
        const reason = waitingAbandonReason(asRequest(row))
        return reason ? [{ id: row.id, reason }] : []
      })
    : cohort.attendances.flatMap((row) => {
        const verdict = attendanceAbandonOf(asAttendance(row))
        return verdict && verdict.side === query.kind ? [{ id: row.id, reason: verdict.reason }] : []
      })
  const total = matches.length
  if (total === 0) return { kind: query.kind, total, page: 1, pageSize, items: [] }
  const reasonOf = new Map(matches.map((match) => [match.id, match.reason]))
  // A ordem (mais recentes primeiro) vem do banco, sobre os ids que a regra do domínio escolheu; a página é cortada lá.
  const offset = (page - 1) * pageSize
  const rows = (
    await db.query<{ id: string; abandoned_at: Date; request_id: string; protocol: string; created_at: Date; team_name: string | null; subteam_name: string | null; operator_person_id: string; anjo_person_id: string | null; started_at: Date | null }>(
      waiting
        ? `select r.id, r.ended_at abandoned_at, r.id request_id, r.protocol, r.created_at, t.name team_name, st.name subteam_name, r.operator_person_id, null::uuid anjo_person_id, null::timestamptz started_at
             from human_support_requests r left join teams t on t.id = r.team_id left join subteams st on st.id = r.subteam_id
            where r.organization_id = $1 and r.id = any($2::uuid[]) order by abandoned_at desc, r.id desc limit $3 offset $4`
        : `select a.id, a.ended_at abandoned_at, r.id request_id, r.protocol, r.created_at, t.name team_name, st.name subteam_name, r.operator_person_id, a.anjo_person_id, a.started_at
             from human_support_attendances a join human_support_requests r on r.id = a.request_id left join teams t on t.id = r.team_id left join subteams st on st.id = r.subteam_id
            where a.organization_id = $1 and a.id = any($2::uuid[]) order by abandoned_at desc, a.id desc limit $3 offset $4`,
      [viewer.organizationId, [...reasonOf.keys()], pageSize, offset],
    )
  ).rows
  const people = await loadPersonPresentations(db, viewer.organizationId, rows.flatMap((row) => [row.operator_person_id, ...(row.anjo_person_id ? [row.anjo_person_id] : [])]))
  const ref = (personId: string, fallback: string): PersonRef => ({ personId, name: people.get(personId)?.displayName ?? fallback, avatarUrl: people.get(personId)?.avatarUrl ?? null })
  return {
    kind: query.kind,
    total,
    page,
    pageSize,
    items: rows.map((row) => {
      const operator = ref(row.operator_person_id, "Operador")
      const anjo = row.anjo_person_id ? ref(row.anjo_person_id, "Anjo") : null
      return {
        at: row.abandoned_at.toISOString(),
        reason: reasonOf.get(row.id)!,
        person: query.kind === "ANJO" && anjo ? anjo : operator,
        counterpart: query.kind === "ANJO" ? operator : anjo,
        request: { id: row.request_id, protocol: row.protocol, createdAt: row.created_at.toISOString(), teamName: row.team_name, subteamName: row.subteam_name },
        attendanceStartedAt: row.started_at?.toISOString() ?? null,
      }
    }),
  }
}
