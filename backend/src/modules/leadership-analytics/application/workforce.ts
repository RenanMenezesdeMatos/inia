import type { PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { isSensitiveLeave, leaveTypeVisible, MINIMUM_SENSITIVE_AGGREGATE_POPULATION, sensitiveBreakdownAllowed, SENSITIVE_LEAVE_STATUSES } from "../../org-structure/domain/management-metrics.js"
import { EMPLOYMENT_STATUS_LABELS, toCanonicalEmploymentStatus, type EmploymentStatus } from "../../people/domain/employment-status.js"
import { ROLE_LABELS } from "../../performance-analytics/domain/hierarchy-levels.js"
import type { PlatformRole } from "../../auth/infrastructure/jwt.js"
import type { QueryTableCard, QueryTableColumn } from "../domain/view-models.js"
import { buildCard, finish, groupCell, groupsFor, share, type QueryGrouping, type SortableRow } from "./query-common.js"
import type { ResolvedStructure } from "./references.js"

/**
 * FORÇA DE TRABALHO da estrutura numa data: quantas pessoas (e quantos %) em cada situação funcional — em produção, férias,
 * afastamento, atividade off… — por recorte, e QUEM, quando pedido. A situação vem dos períodos vigentes na data (mesmo resolvedor do
 * resto da plataforma; sem período = em produção presumido). Privacidade (regra das métricas gerenciais): INSS, maternidade e
 * paternidade só aparecem separados para operadores, em recortes com ao menos 5 deles, e NUNCA por nome — na lista, "Afastamento
 * (motivo protegido)"; o afastamento de um líder só entra somado, na coluna de motivo protegido (C14).
 */

export type StatusLoader = (personIds: string[], date: string) => Promise<Map<string, string | null>>
export type StatusFreshness = { state: string; lastSuccessLocalDate: string | null }

/** Situações pedidas em linguagem de negócio → status canônicos. AFASTAMENTO = os sensíveis somados. */
export const WORKFORCE_STATUS_FILTERS: Record<string, EmploymentStatus[]> = {
  EM_PRODUCAO: ["EM_PRODUCAO"],
  FERIAS: ["FERIAS"],
  AFASTAMENTO: [...SENSITIVE_LEAVE_STATUSES],
  ATIVIDADE_OFF: ["ATIVIDADE_OFF"],
  TRANSFERIDO: ["TRANSFERIDO"],
  APOSENTADO: ["APOSENTADO"],
  PILOTO: ["PILOTO"],
}

/** AFASTAMENTO = total dos sensíveis; AFASTAMENTO_PROTEGIDO = os que entram sem o tipo ao lado dos tipos (afastamento de líder). */
type WorkforceColumn = EmploymentStatus | "AFASTAMENTO" | "AFASTAMENTO_PROTEGIDO"
const DISPLAY_ORDER: WorkforceColumn[] = ["EM_PRODUCAO", "FERIAS", "AFASTAMENTO", "INSS", "MATERNIDADE", "PATERNIDADE", "AFASTAMENTO_PROTEGIDO", "ATIVIDADE_OFF", "PILOTO", "TRANSFERIDO", "APOSENTADO"]
const isSensitive = (status: EmploymentStatus) => isSensitiveLeave(status)
const STATUS_TEXT: Record<WorkforceColumn, string> = {
  EM_PRODUCAO: "Em produção",
  FERIAS: "Férias",
  AFASTAMENTO: "Afastamento",
  AFASTAMENTO_PROTEGIDO: "Afastamento (motivo protegido)",
  INSS: "INSS",
  MATERNIDADE: "Licença-maternidade",
  PATERNIDADE: "Licença-paternidade",
  ATIVIDADE_OFF: "Atividade off",
  PILOTO: "Piloto",
  TRANSFERIDO: "Transferido",
  APOSENTADO: "Aposentado",
}
const labelOf = (status: WorkforceColumn) => STATUS_TEXT[status] ?? (status === "AFASTAMENTO" || status === "AFASTAMENTO_PROTEGIDO" ? "Afastamento" : EMPLOYMENT_STATUS_LABELS[status])

export async function buildWorkforce(
  scope: ViewerScope,
  input: { structure: ResolvedStructure; groupBy: QueryGrouping; date: string; dateLabel: string; statuses: EmploymentStatus[] | null; listPeople: boolean; includeLeaders: boolean; loadStatuses: StatusLoader; freshness: StatusFreshness | null; limit: number; now: Date },
): Promise<QueryTableCard> {
  const limitations: string[] = []
  const population = input.includeLeaders ? peopleBelow(scope, input.structure) : input.structure.resolved.members
  const statuses = await input.loadStatuses(population.map((person) => person.id), input.date)
  const statusOf = (person: PersonNode): EmploymentStatus => {
    const raw = statuses.get(person.id)
    return (raw ? toCanonicalEmploymentStatus(raw) : null) ?? "EM_PRODUCAO"
  }
  if (input.freshness?.state === "STALE") limitations.push(`A fonte de situação funcional está atrasada (última carga em ${input.freshness.lastSuccessLocalDate ?? "data desconhecida"}): quem não tem período informado aparece como em produção presumida.`)
  const methods = [
    "Situação = período vigente na data (férias, INSS, maternidade…); sem período informado, em produção presumida. Situação funcional nunca tira a pessoa da estrutura.",
    `% = pessoas na situação ÷ pessoas do recorte. Afastamentos sensíveis (INSS, maternidade, paternidade) só aparecem separados para operadores, em recortes com ao menos ${MINIMUM_SENSITIVE_AGGREGATE_POPULATION} operadores e quando a contagem não aponta ninguém (dois tipos ou mais, com 2+ pessoas cada); o de líderes só aparece somado, como motivo protegido; nunca por nome.`,
    input.includeLeaders ? "População: todas as pessoas ativas abaixo da estrutura (operadores e líderes)." : "População: operadores ativos da estrutura.",
  ]
  const wanted = input.statuses && input.statuses.length > 0 ? new Set(input.statuses) : null

  if (input.listPeople) {
    const rows: SortableRow[] = []
    const unitOf = new Map<string, string>()
    const { groups } = groupsFor(scope, { structure: input.structure, groupBy: "UNIT" }, [])
    for (const group of groups) if (group.key !== "structure") for (const member of group.members) unitOf.set(member.id, group.label)
    for (const person of population) {
      const status = statusOf(person)
      if (wanted && !wanted.has(status)) continue
      rows.push({
        cells: { person: person.name, role: ROLE_LABELS[person.role as PlatformRole] ?? person.role, unit: unitOf.get(person.id) ?? "—", status: isSensitive(status) ? "Afastamento (motivo protegido)" : labelOf(status) },
        subject: null,
        personId: person.role === "OPERATOR" ? person.id : null,
        sortKeys: { NAME: person.name },
      })
    }
    const columns: QueryTableColumn[] = [{ key: "person", label: "Pessoa", numeric: false }, ...(input.includeLeaders ? [{ key: "role", label: "Nível", numeric: false }] : []), ...(unitOf.size > 0 ? [{ key: "unit", label: "Unidade", numeric: false }] : []), { key: "status", label: "Situação", numeric: false }]
    const { rows: finalRows, total } = finish(rows, { sort: "NAME", order: "asc", limit: input.limit }, "NAME", "asc")
    return buildCard({ structure: input.structure, source: "OFFICIAL", now: input.now }, { title: `Pessoas por situação funcional — ${input.dateLabel}`, scopeNote: `Situação em ${input.dateLabel}`, period: null, indicatorCode: null, columns, rows: finalRows, total, methods, limitations })
  }

  const { groups, label } = groupsFor(scope, { structure: input.structure, groupBy: input.groupBy === "PERSON" || input.groupBy === "PERIOD" ? "STRUCTURE" : input.groupBy }, limitations)
  const groupMembers = (members: PersonNode[]) => (input.includeLeaders ? population.filter((person) => members.some((member) => member.id === person.id) || isLeaderAbove(scope, person, members)) : members)
  const rows: SortableRow[] = []
  const counted = new Set<string>()
  for (const group of groups) {
    const members = group.key === "structure" ? population : groupMembers(group.members)
    const counts = new Map<WorkforceColumn, number>()
    const operators = members.filter(leaveTypeVisible)
    const typed = sensitiveBreakdownAllowed(operators.length, operators.map(statusOf))
    const add = (key: WorkforceColumn) => counts.set(key, (counts.get(key) ?? 0) + 1)
    for (const person of members) {
      const status = statusOf(person)
      if (!isSensitive(status)) add(status)
      else {
        // Sensível: sempre no total de afastamentos; o tipo só de operador e em recorte cujos operadores não apontem ninguém — o
        // de líder, ao lado dos tipos, só como motivo protegido.
        add("AFASTAMENTO")
        if (typed) add(leaveTypeVisible(person) ? status : "AFASTAMENTO_PROTEGIDO")
      }
    }
    for (const key of counts.keys()) counted.add(key)
    rows.push({ cells: { group: groupCell(group, label), total: String(members.length), ...Object.fromEntries([...counts].map(([key, count]) => [key, share(count, members.length)])) }, subject: group.subject, personId: null, sortKeys: { NAME: group.label, BELOW: wanted ? members.filter((person) => wanted.has(statusOf(person))).length : members.length } })
  }
  const shown = DISPLAY_ORDER.filter((key) => {
    const leaveTotal = key === "AFASTAMENTO" || key === "AFASTAMENTO_PROTEGIDO"
    if (!counted.has(key) && !(wanted && !leaveTotal && wanted.has(key))) return false
    if (!wanted) return true
    return leaveTotal ? [...wanted].some(isSensitive) : wanted.has(key)
  })
  const columns: QueryTableColumn[] = [{ key: "group", label, numeric: false }, { key: "total", label: "Pessoas", numeric: true }, ...shown.map((key) => ({ key, label: key === "AFASTAMENTO" ? "Afastamentos (total)" : labelOf(key), numeric: true }))]
  for (const row of rows) for (const column of columns) row.cells[column.key] ??= "0"
  const { rows: finalRows, total } = finish(rows, { sort: wanted ? "BELOW" : "NAME", order: wanted ? "desc" : "asc", limit: input.limit }, "NAME", "asc")
  return buildCard({ structure: input.structure, source: "OFFICIAL", now: input.now }, { title: `Situação funcional por ${label.toLowerCase()} — ${input.dateLabel}`, scopeNote: `Situação em ${input.dateLabel}`, period: null, indicatorCode: null, columns, rows: finalRows, total, methods, limitations })
}

/** Todas as pessoas ativas abaixo da âncora (qualquer nível) — para "quantas pessoas da minha estrutura…" incluindo líderes. No
 * ESCOPO de quem pergunta: também define quem um report distribuído pode juntar na mesma entrega (report-executor.ts). */
export function peopleBelow(scope: ViewerScope, structure: ResolvedStructure): PersonNode[] {
  const anchorId = structure.resolved.anchor?.id
  if (!anchorId) return structure.resolved.members
  const result: PersonNode[] = []
  const stack = [...(scope.children.get(anchorId) ?? [])]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const node = stack.pop()!
    if (visited.has(node.id)) continue
    visited.add(node.id)
    if (node.active) result.push(node)
    stack.push(...(scope.children.get(node.id) ?? []))
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

/** Líder que está acima de algum membro do recorte (entra no recorte quando a população inclui líderes). */
function isLeaderAbove(scope: ViewerScope, person: PersonNode, members: PersonNode[]): boolean {
  if (person.role === "OPERATOR") return false
  return members.some((member) => {
    let cursor = member.reportsToId
    while (cursor) {
      if (cursor === person.id) return true
      cursor = scope.nodes.get(cursor)?.reportsToId ?? null
    }
    return false
  })
}
