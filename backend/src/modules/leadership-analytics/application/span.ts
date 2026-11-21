import type { PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { ROLE_LABELS } from "../../performance-analytics/domain/hierarchy-levels.js"
import type { PlatformRole } from "../../auth/infrastructure/jwt.js"
import type { QueryTableCard, QueryTableColumn, QueryTableRow } from "../domain/view-models.js"
import { buildCard, num, round1 } from "./query-common.js"
import type { ResolvedStructure } from "./references.js"
import { peopleBelow } from "./workforce.js"

/**
 * SPAN DE CONTROLE da estrutura: quantas pessoas de um nível (operadores, por padrão, ou líderes: supervisores por gerente…) cada líder
 * de um nível acima (supervisor, por padrão) tem abaixo dele — por líder (nominal), por Grupo ou por Subgrupo, e o total com média,
 * mediana, mínimo e máximo. Tudo calculado aqui, a partir do organograma vigente; o modelo só repassa. Cada pessoa contada conta para o
 * primeiro líder do nível pedido acima dele; quem não tem esse líder fica fora da média e é dito na limitação. O Grupo de um líder contado
 * é o dos operadores abaixo dele (o mais frequente), para que "supervisores por gerente, por Grupo" não junte contagens que não se casam.
 */

export type SpanLevel = "SUPERVISOR" | "COORDINATOR" | "MANAGER" | "SENIOR_MANAGER"
export type SpanView = "LEADER" | "TEAM" | "SUBTEAM"
export type SpanCounted = "OPERATOR" | "SUPERVISOR" | "COORDINATOR" | "MANAGER"
const RANK: Record<string, number> = { OPERATOR: 0, SUPERVISOR: 1, COORDINATOR: 2, MANAGER: 3, SENIOR_MANAGER: 4 }
/** O nível contado precisa estar abaixo do nível do líder. */
export const spanLevelsValid = (level: SpanLevel, counted: SpanCounted) => RANK[counted]! < RANK[level]!
/** Por líder, até o total de supervisores de uma diretoria grande; por Grupo/Subgrupo, todos. */
export const MAX_SPAN_ROWS = 300

const median = (values: readonly number[]) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const ratio = (operators: number, leaders: number) => (leaders > 0 ? round1(operators / leaders) : null)

/** O primeiro líder do nível pedido acima da pessoa (ou null). */
function leaderAt(scope: ViewerScope, person: PersonNode, level: string): PersonNode | null {
  const visited = new Set<string>()
  let cursor = person.reportsToId
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor)
    const node = scope.nodes.get(cursor)
    if (!node) return null
    if (node.role === level) return node
    cursor = node.reportsToId
  }
  return null
}

const labelOf = (role: string) => (ROLE_LABELS[role as PlatformRole] ?? role).toLowerCase()
const pluralOf = (label: string) => (label.endsWith("r") ? `${label}es` : `${label}s`)
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function buildSpan(scope: ViewerScope, input: { structure: ResolvedStructure; level: SpanLevel; counted?: SpanCounted; view: SpanView; limit: number; now: Date }): QueryTableCard {
  const counted = input.counted ?? "OPERATOR"
  const levelLabel = labelOf(input.level)
  const plural = pluralOf(levelLabel)
  const countedPlural = pluralOf(labelOf(counted))
  const operators = input.structure.resolved.members.filter((person) => person.role === "OPERATOR" && person.active)
  const subjects = counted === "OPERATOR" ? operators : peopleBelow(scope, input.structure).filter((person) => person.role === counted && person.active)
  // Grupo/Subgrupo de quem é contado: o próprio, para operador; o dos operadores abaixo dele (o mais frequente), para líder.
  const placeOf = new Map<string, PersonNode[]>()
  if (counted === "OPERATOR") for (const operator of operators) placeOf.set(operator.id, [operator])
  else
    for (const operator of operators) {
      const leader = leaderAt(scope, operator, counted)
      if (leader) placeOf.set(leader.id, [...(placeOf.get(leader.id) ?? []), operator])
    }
  const byLeader = new Map<string, { leader: PersonNode; operators: PersonNode[] }>()
  let withoutLeader = 0
  for (const subject of subjects) {
    const leader = leaderAt(scope, subject, input.level)
    if (!leader) {
      withoutLeader += 1
      continue
    }
    const entry = byLeader.get(leader.id) ?? { leader, operators: [] }
    entry.operators.push(subject)
    byLeader.set(leader.id, entry)
  }
  // Regra única com a hierarquia (`org_hierarchy`, run-8 ARQ-01): o líder do nível que está na estrutura e não tem ninguém abaixo entra com
  // ZERO — a média, a mediana e o mínimo não o ignoram. Antes, só entrava quem tinha alguém, e as duas ferramentas davam números diferentes.
  for (const person of peopleBelow(scope, input.structure)) {
    if (person.role === input.level && person.active && !byLeader.has(person.id)) byLeader.set(person.id, { leader: person, operators: [] })
  }
  const spans = [...byLeader.values()].map((entry) => entry.operators.length)
  const covered = subjects.length - withoutLeader
  const leaders = byLeader.size
  const highlights = [
    `Total da estrutura: ${leaders} ${leaders === 1 ? levelLabel : plural}, ${covered} ${countedPlural} ativos com ${levelLabel}; span médio = ${num(ratio(covered, leaders))} ${countedPlural} por ${levelLabel} (mediana ${num(median(spans))}, mínimo ${spans.length ? Math.min(...spans) : "—"}, máximo ${spans.length ? Math.max(...spans) : "—"}).`,
  ]
  const limitations: string[] = []
  if (withoutLeader > 0) limitations.push(`${withoutLeader} ${countedPlural} ativos não têm ${levelLabel} acima no organograma e ficaram fora do span.`)
  if (leaders === 0) limitations.push(`Não há ${plural} nesta estrutura.`)
  const methods = [
    `Span = ${countedPlural} ativos abaixo de cada ${levelLabel} (cada um conta para o primeiro ${levelLabel} acima dele no organograma vigente). ${capitalized(plural)} ativos sem ninguém abaixo entram com zero. Média = ${countedPlural} ÷ ${plural}.`,
    counted === "OPERATOR" ? "Situação funcional não tira ninguém da conta: férias e afastamentos continuam no span de quem lidera a pessoa." : `O Grupo de cada ${labelOf(counted)} é o dos operadores abaixo dele (o mais frequente).`,
  ]
  const majority = (people: PersonNode[], key: (person: PersonNode) => string) => {
    const counts = new Map<string, number>()
    for (const person of people) counts.set(key(person), (counts.get(key(person)) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0]?.[0] ?? null
  }
  const groupKey = (view: "TEAM" | "SUBTEAM") => (person: PersonNode) => (view === "TEAM" ? person.teamName ?? "Sem Grupo" : `${person.teamName ?? "Sem Grupo"} › ${person.subteamName ?? "Sem Subgrupo"}`)
  const placeKey = (subject: PersonNode, view: "TEAM" | "SUBTEAM") => majority(placeOf.get(subject.id) ?? [], groupKey(view)) ?? (view === "TEAM" ? "Sem Grupo" : "Sem Grupo › Sem Subgrupo")

  let columns: QueryTableColumn[]
  let rows: QueryTableRow[]
  if (input.view === "LEADER") {
    const teamOf = (list: PersonNode[]) => {
      const counts = new Map<string, number>()
      for (const person of list) counts.set(placeKey(person, "TEAM"), (counts.get(placeKey(person, "TEAM")) ?? 0) + 1)
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).join(", ")
    }
    columns = [{ key: "leader", label: ROLE_LABELS[input.level as PlatformRole] ?? input.level, numeric: false }, { key: "team", label: "Grupo", numeric: false }, { key: "operators", label: capitalized(countedPlural), numeric: true }]
    rows = [...byLeader.values()]
      .sort((a, b) => a.leader.name.localeCompare(b.leader.name, "pt-BR"))
      .map((entry) => ({ cells: { leader: entry.leader.name, team: teamOf(entry.operators), operators: String(entry.operators.length) }, subject: input.level === "SUPERVISOR" ? { kind: "SUPERVISOR_TEAM", supervisorId: entry.leader.id } : null, personId: null }) as QueryTableRow)
  } else {
    const view = input.view
    const keyOf = (person: PersonNode) => placeKey(person, view)
    const groups = new Map<string, { operators: number; spans: Map<string, number> }>()
    for (const entry of byLeader.values()) {
      for (const operator of entry.operators) {
        const group = groups.get(keyOf(operator)) ?? { operators: 0, spans: new Map<string, number>() }
        group.operators += 1
        group.spans.set(entry.leader.id, (group.spans.get(entry.leader.id) ?? 0) + 1)
        groups.set(keyOf(operator), group)
      }
    }
    const shared = [...byLeader.values()].filter((entry) => new Set(entry.operators.map(keyOf)).size > 1).length
    if (shared > 0) limitations.push(`${shared} ${shared === 1 ? `${levelLabel} tem` : `${plural} têm`} ${countedPlural} em mais de um ${input.view === "TEAM" ? "Grupo" : "Subgrupo"} e entra${shared === 1 ? "" : "m"} na contagem de cada um; a média de cada recorte usa só os ${countedPlural} dele.`)
    columns = [
      { key: "group", label: input.view === "TEAM" ? "Grupo" : "Subgrupo", numeric: false },
      { key: "leaders", label: capitalized(plural), numeric: true },
      { key: "operators", label: capitalized(countedPlural), numeric: true },
      { key: "average", label: `Média por ${levelLabel}`, numeric: true },
      { key: "min", label: "Mínimo", numeric: true },
      { key: "max", label: "Máximo", numeric: true },
    ]
    rows = [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([name, group]) => {
        const values = [...group.spans.values()]
        return { cells: { group: name, leaders: String(group.spans.size), operators: String(group.operators), average: num(ratio(group.operators, group.spans.size)), min: String(Math.min(...values)), max: String(Math.max(...values)) }, subject: null, personId: null }
      })
  }
  const limit = Math.min(MAX_SPAN_ROWS, Math.max(1, input.limit))
  const viewLabel = input.view === "LEADER" ? `por ${levelLabel}` : input.view === "TEAM" ? "por Grupo" : "por Subgrupo"
  return buildCard(
    { structure: input.structure, source: "OFFICIAL", now: input.now },
    { title: `Span de controle ${viewLabel}${counted === "OPERATOR" ? "" : ` (${countedPlural})`}`, scopeNote: "Organograma vigente", period: null, indicatorCode: null, columns, rows: rows.slice(0, limit), total: rows.length, methods, limitations, highlights },
  )
}
