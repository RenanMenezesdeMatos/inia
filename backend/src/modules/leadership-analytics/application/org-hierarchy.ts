import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import type { PlatformRole } from "../../auth/infrastructure/jwt.js"
import type { AnalyticsReadRepository, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import { ROLE_LABELS } from "../../performance-analytics/domain/hierarchy-levels.js"
import { matchesAllTokens, normalizeForMatch } from "../domain/analytic-rules.js"
import type { QueryTableCard, QueryTableColumn, StructureRef } from "../domain/view-models.js"
import { queryTableMarkdown } from "./query-common.js"
import type { LeadershipToolResult } from "./leadership-toolset.js"

/**
 * HIERARQUIA DA ORGANIZAÇÃO (`org_hierarchy`): o organograma (`people.reports_to_id`) é ABERTO — decisão do produto (20/11/2026):
 * qualquer pessoa, operador ou liderança, consulta a hierarquia de qualquer pessoa da organização ("quem é meu chefe", "quantas pessoas
 * estão abaixo de fulano", "quantas pessoas respondem a cicrano", "quantos supervisores tem cada gerente"). Por isso esta ferramenta NÃO
 * usa o escopo de acesso (`ViewerScope`): lê a organização inteira, mas só o que é organograma — nome, cargo, Grupo, Subgrupo e a quem a
 * pessoa responde. Nenhum resultado, situação funcional, afastamento, escala ou dado de contato sai daqui (esses continuam nas ferramentas
 * com escopo). Quem está inativo no cadastro não é contado nem listado; um líder inativo no meio da cadeia aparece pelo nome (sem marca de situação) e
 * não interrompe a contagem de quem está abaixo dele.
 *
 * Toda contagem, percentual, soma, média, mediana, mínimo e máximo é calculada AQUI sobre TODAS as pessoas do recorte (a lista mostrada
 * pode ser cortada pelo limite; os números nunca). Contas adicionais sobre esses números vão para a calculadora (`leadership_calculate`
 * / `my_calculate`).
 */

export const HIERARCHY_TOOL = "org_hierarchy"

const ROLE_ARGS: Record<string, PlatformRole> = {
  OPERADOR: "OPERATOR",
  SUPERVISOR: "SUPERVISOR",
  COORDENADOR: "COORDINATOR",
  GERENTE: "MANAGER",
  GERENTE_SENIOR: "SENIOR_MANAGER",
  DIRETOR: "DIRECTOR",
  ADMINISTRADOR: "ADMIN",
}
const LEADER_GROUPINGS: Record<string, PlatformRole> = { SUPERVISOR: "SUPERVISOR", COORDENADOR: "COORDINATOR", GERENTE: "MANAGER", GERENTE_SENIOR: "SENIOR_MANAGER", DIRETOR: "DIRECTOR" }
const QUERIES = ["PESSOA", "DIRETOS", "ABAIXO", "PARES", "CONTAGEM"] as const
type HierarchyQuery = (typeof QUERIES)[number]
const GROUPINGS = ["NENHUM", "CARGO", "GRUPO", "SUBGRUPO", "LIDER_DIRETO", ...Object.keys(LEADER_GROUPINGS)] as const
type Grouping = (typeof GROUPINGS)[number]

export const MAX_HIERARCHY_ROWS = 300
const DEFAULT_ROWS = 50
const MAX_CANDIDATES = 8
const SELF_WORDS = new Set(["eu", "mim", "me", "meu", "minha", "eu mesmo", "eu mesma", "quem pergunta"])

export const HIERARCHY_DECLARATION: FunctionDeclaration = {
  name: HIERARCHY_TOOL,
  description:
    "HIERARQUIA / ORGANOGRAMA da organização inteira — aberto a todos (qualquer pessoa consulta a hierarquia de qualquer pessoa). Traz só o organograma: nome, cargo, Grupo, Subgrupo e a quem cada pessoa responde. " +
    "Use para \"quem é meu chefe/supervisor/coordenador/gerente\", \"a quem fulano responde\", \"quem está acima de mim\", \"quem são meus colegas de equipe\", \"quem responde diretamente a fulano\", \"quantas pessoas estão abaixo de fulano\", \"quantos operadores tem a estrutura do cicrano\", \"quantos supervisores tem cada gerente\", \"quantas pessoas tem cada Grupo\", \"qual % da organização é de operadores\". " +
    "O sistema calcula todas as contagens, percentuais, somas, médias, medianas, mínimos e máximos sobre TODAS as pessoas do recorte — nunca conte a partir de uma lista. Não traz resultados, indicadores, situação funcional nem escala.",
  parameters: {
    type: "object",
    properties: {
      consulta: {
        type: "string",
        enum: [...QUERIES],
        description:
          "PESSOA (padrão) = ficha da pessoa: cargo, Grupo, líder direto, toda a cadeia acima até o topo, quantos respondem diretamente e quantos estão abaixo (por cargo). DIRETOS = quem responde diretamente à pessoa. ABAIXO = todas as pessoas abaixo da pessoa, em qualquer nível. PARES = quem tem o mesmo líder direto da pessoa. CONTAGEM = contagens da organização inteira (ou só da estrutura de estrutura_de), agrupadas por agrupar_por — com agrupar_por = um nível de líder (ex.: GERENTE + cargos [SUPERVISOR]) vira o span: quantos de cada líder, com média, mediana, mínimo e máximo.",
      },
      pessoa: { type: "string", description: "Nome da pessoa (PESSOA, DIRETOS, ABAIXO, PARES). Omita para quem pergunta (\"meu chefe\", \"minha equipe\")." },
      estrutura_de: { type: "string", description: "Só na CONTAGEM: nome de um líder para contar apenas a estrutura abaixo dele. Omita para a organização inteira." },
      cargos: { type: "array", items: { type: "string", enum: Object.keys(ROLE_ARGS) }, description: "Contar/listar só estes cargos (ex.: [OPERADOR] = só operadores). Vazio = todos." },
      grupo: { type: "string", description: "Filtrar pelo nome do Grupo." },
      subgrupo: { type: "string", description: "Filtrar pelo nome do Subgrupo." },
      agrupar_por: { type: "string", enum: [...GROUPINGS], description: "Linhas da contagem (ABAIXO e CONTAGEM): CARGO (padrão), GRUPO, SUBGRUPO, LIDER_DIRETO, um nível de líder (SUPERVISOR, COORDENADOR, GERENTE, GERENTE_SENIOR, DIRETOR) ou NENHUM (só o total)." },
      listar_pessoas: { type: "boolean", description: "ABAIXO/CONTAGEM: em vez da contagem agrupada, a lista nominal das pessoas (o total continua sobre todas)." },
      limite: { type: "integer", description: `Máximo de linhas mostradas (padrão ${DEFAULT_ROWS}, máximo ${MAX_HIERARCHY_ROWS}).` },
    },
  },
}

/** Regra de escolha da ferramenta — a mesma frase para a liderança e para o operador. */
export const HIERARCHY_RULE =
  "- HIERARQUIA / ORGANOGRAMA (quem é o chefe, supervisor, coordenador ou gerente de alguém, inclusive o seu; a quem alguém responde; quem está acima ou abaixo; colegas de equipe; quantas pessoas respondem a alguém ou estão abaixo dele; quantos operadores, supervisores ou gerentes há por líder, Grupo ou na organização, e o %) → org_hierarchy. A hierarquia é aberta: qualquer pessoa pode consultar a de qualquer outra — nunca recuse nem diga que não tem acesso a ela. Ela traz só o organograma (nome, cargo, Grupo, Subgrupo, liderança), nunca resultados ou situação de ninguém."

/** Todas as pessoas da organização (ativas ou não — o inativo só aparece pelo nome na cadeia). */
export async function loadOrganizationPeople(repository: AnalyticsReadRepository, organizationId: string): Promise<PersonNode[]> {
  return repository.loadPeopleInVisibility(organizationId, { organizationWide: true, teamIds: [], subteamIds: [] })
}

type Graph = { byId: Map<string, PersonNode>; children: Map<string, PersonNode[]> }

function buildGraph(people: readonly PersonNode[]): Graph {
  const byId = new Map(people.map((person) => [person.id, person]))
  const children = new Map<string, PersonNode[]>()
  for (const person of people) {
    if (!person.reportsToId || !byId.has(person.reportsToId)) continue
    const list = children.get(person.reportsToId) ?? []
    list.push(person)
    children.set(person.reportsToId, list)
  }
  return { byId, children }
}

/** Cadeia acima da pessoa, do líder direto até o topo (protegida contra ciclo no cadastro). */
function chainAbove(graph: Graph, person: PersonNode): PersonNode[] {
  const chain: PersonNode[] = []
  const visited = new Set([person.id])
  let cursor = person.reportsToId
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor)
    const node = graph.byId.get(cursor)
    if (!node) break
    chain.push(node)
    cursor = node.reportsToId
  }
  return chain
}

/** Todas as pessoas abaixo (qualquer profundidade), sem a própria — atravessa líderes inativos. */
function descendants(graph: Graph, root: PersonNode): PersonNode[] {
  const result: PersonNode[] = []
  const visited = new Set([root.id])
  const queue = [...(graph.children.get(root.id) ?? [])]
  while (queue.length > 0) {
    const node = queue.shift()!
    if (visited.has(node.id)) continue
    visited.add(node.id)
    result.push(node)
    queue.push(...(graph.children.get(node.id) ?? []))
  }
  return result
}

const roleLabel = (role: string) => ROLE_LABELS[role as PlatformRole] ?? role
const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—")
const decimal = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const describe = (person: PersonNode) => [roleLabel(person.role), person.teamName, person.subteamName].filter(Boolean).join(", ")
/**
 * Nome na cadeia e nas linhas por líder. Sem marca de inativo (run-8, SL-03): a hierarquia é aberta a todos e nunca mostra situação
 * funcional — a marca deixava qualquer operador listar os líderes inativos (sinal próximo de desligamento). O líder inativo continua na
 * cadeia pelo nome, como está no cadastro, e quem está abaixo dele continua contado.
 */
const MAX_QUERY_TEXT = 120

const nameOf = (person: PersonNode) => person.name

type Outcome<T> = { kind: "OK"; value: T } | { kind: "AMBIGUOUS"; candidates: string[] } | { kind: "NOT_FOUND"; message: string }

/** Pessoa pelo nome entre as ATIVAS da organização; nada/"eu" = quem pergunta. Homônimos = ambiguidade com cargo e Grupo. */
function resolvePerson(people: readonly PersonNode[], viewer: PersonNode, text: string | null): Outcome<PersonNode> {
  if (!text || SELF_WORDS.has(normalizeForMatch(text))) return { kind: "OK", value: viewer }
  const active = people.filter((person) => person.active)
  const normalized = normalizeForMatch(text)
  const exact = active.filter((person) => normalizeForMatch(person.name) === normalized)
  const matches = exact.length > 0 ? exact : active.filter((person) => matchesAllTokens(person.name, text))
  if (matches.length === 1) return { kind: "OK", value: matches[0]! }
  if (matches.length > 1) return { kind: "AMBIGUOUS", candidates: matches.slice(0, MAX_CANDIDATES).map((person) => `${person.name} (${describe(person)})`) }
  return { kind: "NOT_FOUND", message: `Não encontrei "${text}" entre as pessoas ativas da organização.` }
}

/** Grupo/Subgrupo pelo nome (exato ou todas as palavras), entre os que existem no organograma. */
function resolveUnit(people: readonly PersonNode[], text: string | null, kind: "team" | "subteam"): Outcome<string> | null {
  if (!text) return null
  const names = new Map<string, string>()
  for (const person of people) {
    const id = kind === "team" ? person.teamId : person.subteamId
    const name = kind === "team" ? person.teamName : person.subteamName
    if (id && name) names.set(id, name)
  }
  const entries = [...names.entries()]
  const normalized = normalizeForMatch(text)
  const exact = entries.filter(([, name]) => normalizeForMatch(name) === normalized)
  const matches = exact.length > 0 ? exact : entries.filter(([, name]) => matchesAllTokens(name, text))
  if (matches.length === 1) return { kind: "OK", value: matches[0]![0] }
  const what = kind === "team" ? "Grupo" : "Subgrupo"
  if (matches.length > 1) return { kind: "AMBIGUOUS", candidates: matches.slice(0, MAX_CANDIDATES).map(([, name]) => `${name} (${what})`) }
  return { kind: "NOT_FOUND", message: `Não encontrei o ${what} "${text}".` }
}

function issueResult(outcome: Exclude<Outcome<unknown>, { kind: "OK" }>, what: string): LeadershipToolResult {
  if (outcome.kind === "AMBIGUOUS") return { text: `Ambiguidade (${what}): há mais de uma opção — ${outcome.candidates.join("; ")}. Pergunte ao usuário qual delas, sem escolher por conta própria.`, card: null, issue: { kind: "AMBIGUOUS", message: `Há mais de uma opção de ${what}: ${outcome.candidates.join("; ")}.`, candidates: outcome.candidates } }
  return { text: `${outcome.message} Diga isso ao usuário; não invente nomes.`, card: null, issue: { kind: "NOT_FOUND", message: outcome.message, candidates: [] } }
}

const METHODS = [
  "Organograma vigente do cadastro (a quem cada pessoa responde), aberto a todos. Só pessoas ativas são contadas e listadas; um líder inativo na cadeia aparece pelo nome e quem está abaixo dele continua contado.",
  "Contagens, percentuais, médias, medianas, mínimos e máximos calculados pelo sistema sobre todas as pessoas do recorte (a lista pode estar limitada; os números não).",
]

export type HierarchyInput = { people: readonly PersonNode[]; viewer: PersonNode; args: Record<string, unknown>; now: Date }

export function runHierarchyQuery(input: HierarchyInput): LeadershipToolResult {
  const { people, viewer, args, now } = input
  const graph = buildGraph(people)
  const viewerNode = graph.byId.get(viewer.id) ?? viewer
  // Nomes de pessoa, líder, Grupo e Subgrupo: no máximo MAX_QUERY_TEXT caracteres (run-8, SL-02 — o texto é comparado com cada pessoa da
  // organização; sem teto, um corpo de 1 MB prendia o processo).
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_QUERY_TEXT) : null)
  const query: HierarchyQuery = QUERIES.find((value) => value === args.consulta) ?? "PESSOA"
  const roles = Array.isArray(args.cargos) ? args.cargos.flatMap((value) => (ROLE_ARGS[String(value)] ? [ROLE_ARGS[String(value)]!] : [])) : []
  const limit = Math.min(MAX_HIERARCHY_ROWS, Math.max(1, typeof args.limite === "number" ? Math.round(args.limite) : DEFAULT_ROWS))
  const team = resolveUnit(people, str(args.grupo), "team")
  if (team && team.kind !== "OK") return issueResult(team, "Grupo")
  const subteam = resolveUnit(people, str(args.subgrupo), "subteam")
  if (subteam && subteam.kind !== "OK") return issueResult(subteam, "Subgrupo")
  const teamId = team?.kind === "OK" ? team.value : null
  const subteamId = subteam?.kind === "OK" ? subteam.value : null
  const filtersNote = [
    roles.length > 0 ? `cargos: ${roles.map(roleLabel).join(", ")}` : null,
    teamId ? `Grupo: ${people.find((person) => person.teamId === teamId)?.teamName}` : null,
    subteamId ? `Subgrupo: ${people.find((person) => person.subteamId === subteamId)?.subteamName}` : null,
  ].filter(Boolean).join(" · ")
  const passes = (person: PersonNode) => person.active && (roles.length === 0 || roles.includes(person.role as PlatformRole)) && (!teamId || person.teamId === teamId) && (!subteamId || person.subteamId === subteamId)
  const structure: StructureRef = { subject: { kind: "EMPLOYEE", employeeId: viewer.id }, label: "Hierarquia da organização", description: "Organograma" }
  const card = (content: { title: string; scopeNote: string; columns: QueryTableColumn[]; rows: Record<string, string>[]; total: number; highlights: string[]; limitations?: string[] }): QueryTableCard => ({
    type: "QUERY_TABLE",
    generatedAt: now.toISOString(),
    structure,
    source: "OFFICIAL",
    title: content.title,
    scopeNote: content.scopeNote,
    period: null,
    indicatorCode: null,
    columns: content.columns,
    rows: content.rows.map((cells) => ({ cells, subject: null, personId: null })),
    totalRows: content.total,
    highlights: content.highlights,
    methods: METHODS,
    limitations: [...(content.limitations ?? []), ...(content.total > content.rows.length ? [`Mostrando ${content.rows.length} de ${content.total} linhas; os totais consideram todas.`] : [])],
  })
  const personColumns: QueryTableColumn[] = [
    { key: "name", label: "Nome", numeric: false },
    { key: "role", label: "Cargo", numeric: false },
    { key: "team", label: "Grupo", numeric: false },
    { key: "subteam", label: "Subgrupo", numeric: false },
    { key: "leader", label: "Líder direto", numeric: false },
  ]
  const personRow = (person: PersonNode): Record<string, string> => ({ name: person.name, role: roleLabel(person.role), team: person.teamName ?? "—", subteam: person.subteamName ?? "—", leader: person.reportsToId ? (graph.byId.get(person.reportsToId)?.name ?? "—") : "—" })
  const byName = (a: PersonNode, b: PersonNode) => a.name.localeCompare(b.name, "pt-BR")
  const roleBreakdown = (list: readonly PersonNode[]) => {
    const counts = new Map<string, number>()
    for (const person of list) counts.set(person.role, (counts.get(person.role) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([role, count]) => `${roleLabel(role)}: ${count}`).join(", ")
  }

  if (query === "CONTAGEM") {
    const anchorText = str(args.estrutura_de)
    let base: PersonNode[]
    let scopeNote: string
    if (anchorText) {
      const anchor = resolvePerson(people, viewerNode, anchorText)
      if (anchor.kind !== "OK") return issueResult(anchor, "pessoa")
      base = descendants(graph, anchor.value)
      scopeNote = `Estrutura abaixo de ${anchor.value.name} (${roleLabel(anchor.value.role)})`
    } else {
      base = [...people]
      scopeNote = "Organização inteira"
    }
    return finish(groupedCount(base, scopeNote))
  }

  const target = resolvePerson(people, viewerNode, str(args.pessoa))
  if (target.kind !== "OK") return issueResult(target, "pessoa")
  const person = target.value
  const isViewer = person.id === viewer.id
  const who = isViewer ? `${person.name} (quem pergunta)` : person.name

  if (query === "PESSOA") {
    const chain = chainAbove(graph, person)
    const direct = (graph.children.get(person.id) ?? []).filter((node) => node.active)
    const below = descendants(graph, person).filter((node) => node.active)
    const peers = person.reportsToId ? (graph.children.get(person.reportsToId) ?? []).filter((node) => node.active && node.id !== person.id) : []
    const highlights = [
      `${who}: ${describe(person)}.`,
      chain.length > 0 ? `Líder direto: ${nameOf(chain[0]!)} (${roleLabel(chain[0]!.role)}).` : "Não responde a ninguém no cadastro (topo da hierarquia ou líder não informado).",
      `Respondem diretamente: ${direct.length}${direct.length > 0 ? ` (${roleBreakdown(direct)})` : ""}.`,
      `Abaixo, em todos os níveis: ${below.length}${below.length > 0 ? ` (${roleBreakdown(below)})` : ""}.`,
      ...(person.reportsToId ? [`Pares (mesmo líder direto): ${peers.length}.`] : []),
    ]
    const rows = chain.map((leader, index) => ({ level: index === 0 ? "Líder direto" : `${index + 1}º acima`, name: nameOf(leader), role: roleLabel(leader.role), team: leader.teamName ?? "—" }))
    return finish(
      card({
        title: `Hierarquia de ${person.name}`,
        scopeNote: "Cadeia acima, do líder direto até o topo",
        columns: [
          { key: "level", label: "Nível", numeric: false },
          { key: "name", label: "Nome", numeric: false },
          { key: "role", label: "Cargo", numeric: false },
          { key: "team", label: "Grupo", numeric: false },
        ],
        rows,
        total: rows.length,
        highlights,
      }),
    )
  }

  if (query === "DIRETOS" || query === "PARES") {
    const list =
      query === "DIRETOS"
        ? (graph.children.get(person.id) ?? []).filter(passes)
        : person.reportsToId
          ? (graph.children.get(person.reportsToId) ?? []).filter((node) => passes(node) && node.id !== person.id)
          : []
    const sorted = [...list].sort(byName)
    const belowCount = (node: PersonNode) => descendants(graph, node).filter((item) => item.active).length
    const leader = person.reportsToId ? graph.byId.get(person.reportsToId) : null
    const highlights =
      query === "DIRETOS"
        ? [`${sorted.length} ${sorted.length === 1 ? "pessoa responde" : "pessoas respondem"} diretamente a ${who}${sorted.length > 0 ? ` (${roleBreakdown(sorted)})` : ""}.`]
        : leader
          ? [`${sorted.length} ${sorted.length === 1 ? "pessoa tem" : "pessoas têm"} o mesmo líder direto de ${who} (${leader.name}).`]
          : [`${who} não responde a ninguém no cadastro: não há pares.`]
    return finish(
      card({
        title: query === "DIRETOS" ? `Quem responde diretamente a ${person.name}` : `Pares de ${person.name}`,
        scopeNote: [query === "DIRETOS" ? "Subordinados diretos" : `Mesmo líder direto${leader ? `: ${leader.name}` : ""}`, filtersNote].filter(Boolean).join(" · "),
        columns: [...personColumns.slice(0, 4), { key: "below", label: "Pessoas abaixo", numeric: true }],
        rows: sorted.slice(0, limit).map((node) => ({ ...personRow(node), below: String(belowCount(node)) })),
        total: sorted.length,
        highlights,
      }),
    )
  }

  // ABAIXO
  return finish(groupedCount(descendants(graph, person), `Estrutura abaixo de ${person.name} (${roleLabel(person.role)})`))

  function groupedCount(candidates: readonly PersonNode[], scopeNote: string): QueryTableCard {
    const base = candidates.filter(passes)
    const fullNote = [scopeNote, filtersNote].filter(Boolean).join(" · ")
    if (args.listar_pessoas === true) {
      const sorted = [...base].sort(byName)
      return card({ title: "Pessoas na hierarquia", scopeNote: fullNote, columns: personColumns, rows: sorted.slice(0, limit).map(personRow), total: sorted.length, highlights: [`Total: ${base.length} ${base.length === 1 ? "pessoa" : "pessoas"}${base.length > 0 ? ` (${roleBreakdown(base)})` : ""}.`] })
    }
    const grouping: Grouping = GROUPINGS.find((value) => value === args.agrupar_por) ?? "CARGO"
    if (grouping === "NENHUM") {
      return card({ title: "Contagem na hierarquia", scopeNote: fullNote, columns: [{ key: "group", label: "Recorte", numeric: false }, { key: "count", label: "Pessoas", numeric: true }], rows: [{ group: "Total", count: String(base.length) }], total: 1, highlights: [`Total: ${base.length} ${base.length === 1 ? "pessoa" : "pessoas"}${base.length > 0 ? ` (${roleBreakdown(base)})` : ""}.`] })
    }
    const leaderRole = LEADER_GROUPINGS[grouping]
    const counts = new Map<string, { label: string; count: number }>()
    const add = (key: string, label: string, amount: number) => {
      const entry = counts.get(key) ?? { label, count: 0 }
      entry.count += amount
      counts.set(key, entry)
    }
    // Span: todo líder ativo do nível no recorte entra, mesmo com zero (média e mínimo não podem ignorar quem não tem ninguém). Com
    // filtro de Grupo/Subgrupo, o Grupo do líder pode não ser o dos liderados: aí só entram os líderes com alguém no recorte.
    if (leaderRole && !teamId && !subteamId) for (const leader of candidates) if (leader.active && leader.role === leaderRole) add(leader.id, leader.name, 0)
    let withoutGroup = 0
    for (const node of base) {
      if (grouping === "CARGO") add(node.role, roleLabel(node.role), 1)
      else if (grouping === "GRUPO" || grouping === "SUBGRUPO") {
        const unitId = grouping === "GRUPO" ? node.teamId : node.subteamId
        if (unitId) add(unitId, (grouping === "GRUPO" ? node.teamName : node.subteamName) ?? "—", 1)
        else withoutGroup++
      } else if (grouping === "LIDER_DIRETO") {
        const leader = node.reportsToId ? graph.byId.get(node.reportsToId) : null
        if (leader) add(leader.id, nameOf(leader), 1)
        else withoutGroup++
      } else {
        const leader = chainAbove(graph, node).find((item) => item.role === leaderRole)
        if (leader) add(leader.id, nameOf(leader), 1)
        else withoutGroup++
      }
    }
    const groupLabel = { CARGO: "Cargo", GRUPO: "Grupo", SUBGRUPO: "Subgrupo", LIDER_DIRETO: "Líder direto" }[grouping as string] ?? roleLabel(leaderRole ?? "")
    const sorted = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"))
    const rows = sorted.slice(0, limit).map((entry) => ({ group: entry.label, count: String(entry.count), share: pct(entry.count, base.length) }))
    const values = sorted.map((entry) => entry.count)
    const highlights = [`Total: ${base.length} ${base.length === 1 ? "pessoa" : "pessoas"}${base.length > 0 ? ` (${roleBreakdown(base)})` : ""}.`]
    if (values.length > 0 && grouping !== "CARGO") {
      const sum = values.reduce((a, b) => a + b, 0)
      highlights.push(`${values.length} ${groupLabel.toLowerCase()}${values.length === 1 ? "" : groupLabel.endsWith("r") ? "es" : "s"} com linha · média ${decimal(sum / values.length)} por ${groupLabel.toLowerCase()} · mediana ${decimal(median(values))} · mínimo ${Math.min(...values)} · máximo ${Math.max(...values)} (soma das linhas: ${sum}).`)
    }
    const limitations = withoutGroup > 0 ? [`${withoutGroup} ${withoutGroup === 1 ? "pessoa não tem" : "pessoas não têm"} ${groupLabel.toLowerCase()} acima/no cadastro e ${withoutGroup === 1 ? "ficou" : "ficaram"} fora das linhas (mas no total).`] : []
    return card({
      title: `Pessoas por ${groupLabel.toLowerCase()}`,
      scopeNote: fullNote,
      columns: [{ key: "group", label: groupLabel, numeric: false }, { key: "count", label: "Pessoas", numeric: true }, { key: "share", label: "% do total", numeric: true }],
      rows,
      total: sorted.length,
      highlights,
      limitations,
    })
  }
}

function finish(card: QueryTableCard): LeadershipToolResult {
  const text = [
    "[Hierarquia da organização — organograma do cadastro, aberto a todos; use exatamente estes nomes e números]",
    `${card.title} · ${card.scopeNote}`,
    ...(card.highlights.length > 0 ? [`Destaques: ${card.highlights.join(" ")}`] : []),
    "",
    queryTableMarkdown(card),
    ...(card.limitations.length > 0 ? ["", `Limitações: ${card.limitations.join(" ")}`] : []),
    `Base: ${card.methods.join(" ")}`,
  ].join("\n")
  return { text, card }
}

/** Execução completa: carrega o organograma da organização e responde. */
export async function executeHierarchyTool(repository: AnalyticsReadRepository, input: { organizationId: string; viewer: PersonNode; args: Record<string, unknown>; now: Date }): Promise<LeadershipToolResult> {
  const people = await loadOrganizationPeople(repository, input.organizationId)
  return runHierarchyQuery({ people, viewer: input.viewer, args: input.args, now: input.now })
}
