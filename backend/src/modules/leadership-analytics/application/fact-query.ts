import type { PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { QueryTableCard, QueryTableColumn, QueryTableRow } from "../domain/view-models.js"
import { buildCard } from "./query-common.js"
import type { ResolvedStructure } from "./references.js"

/**
 * MOTOR ÚNICO DE CÁLCULO SOBRE REGISTROS (`FACT_QUERY_V1`): atendimentos, avaliações de monitoria, feedbacks e casos chegam como
 * "fatos" (um registro = uma linha, ligado a uma pessoa da estrutura, com dimensões e medidas). O motor recorta, agrupa e calcula —
 * quantidade, soma, média, mediana, mínimo, máximo, percentis, desvio padrão, taxa e a distribuição POR PESSOA (com zero para quem não
 * tem registro) — e devolve a tabela pronta. A INIA nunca faz essas contas: escolhe a ferramenta do domínio, o recorte e as estatísticas.
 * Só pessoas do escopo de quem pergunta entram (o carregamento já filtra pelos membros da estrutura resolvida no backend).
 */

export type Fact = { personId: string; key?: string; dims: Record<string, string | null>; measures: Record<string, number | null> }

export const STATISTICS = ["TOTAL", "MEDIA", "MEDIANA", "MINIMO", "MAXIMO", "P25", "P75", "P90", "DESVIO_PADRAO", "TAXA"] as const
export type Statistic = (typeof STATISTICS)[number]
/** Agrupamentos pela PESSOA (organograma vigente), comuns a todos os domínios. */
export const PERSON_GROUPINGS = ["ESTRUTURA", "PESSOA", "SUPERVISOR", "COORDENADOR", "GERENTE", "GERENTE_SENIOR", "GRUPO", "SUBGRUPO"] as const
export type PersonGrouping = (typeof PERSON_GROUPINGS)[number]
/** Agrupamentos pelo TEMPO do registro, comuns a todos os domínios (a data local do registro vem na dimensão `DIA`). */
export const TIME_GROUPINGS = ["DIA", "SEMANA", "MES", "DIA_DA_SEMANA"] as const

/** `kind`: COUNT_PER_PERSON = registros por pessoa da população; RATE = medida 0/1 (TAXA = % de 1); NUMBER/SECONDS = valor do registro. */
/** ANY_PER_PERSON = 1 para quem tem ao menos um registro, 0 para quem não tem (TAXA = % das pessoas). */
export type MeasureSpec = { key: string; label: string; kind: "COUNT_PER_PERSON" | "DISTINCT_PER_PERSON" | "ANY_PER_PERSON" | "RATE" | "NUMBER" | "SECONDS"; defaultStatistics: Statistic[] }
export type DimensionSpec = { key: string; label: string }

export type FactQueryInput = {
  domainTitle: string
  structure: ResolvedStructure
  /** Pessoas da população (operadores ativos da estrutura): base da distribuição por pessoa, inclusive de quem não tem registro. */
  population: PersonNode[]
  facts: Fact[]
  dimensions: readonly DimensionSpec[]
  measures: readonly MeasureSpec[]
  groupBy: string
  /** Medidas pedidas (vazio = as padrão do domínio). */
  measureKeys: string[]
  statistics: Statistic[] | null
  /** Filtros por dimensão (valor exato, sem diferença de maiúsculas/acentos). */
  filters: Record<string, string[]>
  periodNote: string
  sort: { by: "GROUP" | "VALUE"; order: "asc" | "desc" }
  /** Linhas com menos registros que isso saem da tabela (o total continua com todos). */
  minimumRecords: number
  limit: number
  methods: string[]
  limitations: string[]
  truncated: boolean
  now: Date
}

export const MAX_FACT_ROWS = 300
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase()

export function describe(values: readonly number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (q: number) => {
    const position = (sorted.length - 1) * q
    const low = Math.floor(position)
    const high = Math.ceil(position)
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low)
  }
  const total = sorted.reduce((sum, value) => sum + value, 0)
  const mean = total / sorted.length
  return {
    count: sorted.length,
    TOTAL: total,
    MEDIA: mean,
    MEDIANA: quantile(0.5),
    MINIMO: sorted[0]!,
    MAXIMO: sorted[sorted.length - 1]!,
    P25: quantile(0.25),
    P75: quantile(0.75),
    P90: quantile(0.9),
    DESVIO_PADRAO: Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length),
    TAXA: mean * 100,
  } satisfies Record<Statistic, number> & { count: number }
}

const STAT_LABELS: Record<Statistic, string> = { TOTAL: "total", MEDIA: "média", MEDIANA: "mediana", MINIMO: "mínimo", MAXIMO: "máximo", P25: "percentil 25", P75: "percentil 75", P90: "percentil 90", DESVIO_PADRAO: "desvio padrão", TAXA: "%" }
const decimal = (value: number, digits = 1) => value.toLocaleString("pt-BR", { maximumFractionDigits: digits })
export function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  const rest = rounded % 60
  return minutes > 0 ? `${minutes}min ${String(rest).padStart(2, "0")}s` : `${rest}s`
}
function formatStat(measure: MeasureSpec, statistic: Statistic, value: number): string {
  if (statistic === "TAXA") return value > 0 && value < 0.05 ? "<0,1%" : `${decimal(value)}%`
  if (measure.kind === "SECONDS" && statistic !== "DESVIO_PADRAO" && statistic !== "TOTAL") return formatSeconds(value)
  if (measure.kind === "SECONDS" && statistic === "TOTAL") return `${decimal(value / 3600)} h`
  if (measure.kind === "SECONDS") return `${decimal(value)}s`
  return decimal(value, 2)
}

/** O primeiro líder do papel pedido acima da pessoa. */
export function leaderOf(scope: ViewerScope, person: PersonNode, role: string): PersonNode | null {
  const visited = new Set<string>()
  let cursor = person.reportsToId
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor)
    const node = scope.nodes.get(cursor)
    if (!node) return null
    if (node.role === role) return node
    cursor = node.reportsToId
  }
  return null
}

const LEADER_ROLE: Partial<Record<PersonGrouping, string>> = { SUPERVISOR: "SUPERVISOR", COORDENADOR: "COORDINATOR", GERENTE: "MANAGER", GERENTE_SENIOR: "SENIOR_MANAGER" }
const PERSON_GROUP_LABEL: Record<PersonGrouping, string> = { ESTRUTURA: "Estrutura", PESSOA: "Pessoa", SUPERVISOR: "Supervisor", COORDENADOR: "Coordenador", GERENTE: "Gerente", GERENTE_SENIOR: "Gerente sênior", GRUPO: "Grupo", SUBGRUPO: "Subgrupo" }
const WEEKDAYS = ["1-domingo", "2-segunda", "3-terça", "4-quarta", "5-quinta", "6-sexta", "7-sábado"]

function timeKey(grouping: string, day: string | null): string | null {
  if (!day) return null
  if (grouping === "DIA") return day
  if (grouping === "MES") return day.slice(0, 7)
  const date = new Date(`${day}T12:00:00Z`)
  if (grouping === "DIA_DA_SEMANA") return WEEKDAYS[date.getUTCDay()]!
  // SEMANA: segunda-feira que abre a semana.
  const monday = new Date(date)
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return `semana de ${monday.toISOString().slice(0, 10)}`
}

export function runFactQuery(scope: ViewerScope, input: FactQueryInput): QueryTableCard {
  const limitations = [...input.limitations]
  const personGrouping = (PERSON_GROUPINGS as readonly string[]).includes(input.groupBy) ? (input.groupBy as PersonGrouping) : null
  const timeGrouping = (TIME_GROUPINGS as readonly string[]).includes(input.groupBy) ? input.groupBy : null
  const dimension = input.dimensions.find((item) => item.key === input.groupBy) ?? null
  const groupLabel = personGrouping ? PERSON_GROUP_LABEL[personGrouping] : timeGrouping ? { DIA: "Dia", SEMANA: "Semana", MES: "Mês", DIA_DA_SEMANA: "Dia da semana" }[timeGrouping]! : dimension?.label ?? "Estrutura"
  if (!personGrouping && !timeGrouping && !dimension) limitations.push(`Agrupamento ${input.groupBy} não existe para ${input.domainTitle.toLowerCase()}; mostro a estrutura inteira.`)

  const people = new Map(input.population.map((person) => [person.id, person]))
  // A CHAVE do grupo é o id (pessoa, Grupo, Subgrupo, líder); o nome é só o rótulo — homônimos nunca se somam numa linha.
  const placeOf = (person: PersonNode) => [person.teamName, person.subteamName].filter(Boolean).join(" › ")
  const personGroupOf = (person: PersonNode): { key: string; label: string; context: string } => {
    switch (personGrouping) {
      case "PESSOA":
        return { key: person.id, label: person.name, context: placeOf(person) }
      case "GRUPO":
        return { key: person.teamId ?? "", label: person.teamName ?? "Sem Grupo", context: "" }
      case "SUBGRUPO":
        return { key: `${person.teamId ?? ""}:${person.subteamId ?? ""}`, label: `${person.teamName ?? "Sem Grupo"} › ${person.subteamName ?? "Sem Subgrupo"}`, context: "" }
      case "SUPERVISOR":
      case "COORDENADOR":
      case "GERENTE":
      case "GERENTE_SENIOR": {
        const leader = leaderOf(scope, person, LEADER_ROLE[personGrouping]!)
        return leader ? { key: leader.id, label: leader.name, context: placeOf(leader) } : { key: "", label: `Sem ${PERSON_GROUP_LABEL[personGrouping].toLowerCase()}`, context: "" }
      }
      default:
        return { key: "", label: input.structure.ref.label, context: "" }
    }
  }

  // Filtros por dimensão do registro.
  const activeFilters = Object.entries(input.filters).filter(([, values]) => values.length > 0)
  const filtered = input.facts.filter((fact) => people.has(fact.personId) && activeFilters.every(([key, values]) => {
    const value = fact.dims[key]
    return value !== null && value !== undefined && values.some((wanted) => fold(wanted) === fold(value))
  }))
  for (const [key, values] of activeFilters) {
    const known = new Set(input.facts.map((fact) => fact.dims[key]).filter((value): value is string => Boolean(value)).map(fold))
    const missing = values.filter((value) => !known.has(fold(value)))
    if (missing.length > 0) {
      const options = [...new Set(input.facts.map((fact) => fact.dims[key]).filter((value): value is string => Boolean(value)))].sort().slice(0, 40)
      limitations.push(`${input.dimensions.find((item) => item.key === key)?.label ?? key} "${missing.join(", ")}" não aparece nos registros do período. Valores existentes: ${options.join("; ") || "nenhum"}.`)
    }
  }

  const measures = (input.measureKeys.length > 0 ? input.measures.filter((measure) => input.measureKeys.includes(measure.key)) : input.measures.filter((measure) => measure.defaultStatistics.length > 0)).slice(0, 6)
  const statsFor = (measure: MeasureSpec): Statistic[] => {
    const fallback: Statistic[] = measure.defaultStatistics.length > 0 ? measure.defaultStatistics : measure.kind === "RATE" || measure.kind === "ANY_PER_PERSON" ? ["TAXA"] : ["MEDIA", "MEDIANA"]
    const wanted = input.statistics && input.statistics.length > 0 ? input.statistics : fallback
    return wanted.filter((statistic) => (measure.kind === "RATE" || measure.kind === "ANY_PER_PERSON" ? statistic === "TAXA" || statistic === "TOTAL" : statistic !== "TAXA"))
  }

  // Grupos: pela pessoa (inclui quem não tem registro), pelo tempo ou por uma dimensão do registro.
  type Bucket = { label: string; context: string; personId: string | null; facts: Fact[]; population: Set<string> }
  const buckets = new Map<string, Bucket>()
  const bucket = (label: string, key: string = label, context = "") => {
    const existing = buckets.get(key)
    if (existing) return existing
    const created: Bucket = { label: label.replace(/\s+/g, " ").trim().slice(0, 160), context, personId: null, facts: [], population: new Set() }
    buckets.set(key, created)
    return created
  }
  if (personGrouping || (!timeGrouping && !dimension)) {
    const groupOf = (person: PersonNode) => {
      const group = personGroupOf(person)
      const target = bucket(group.label, group.key, group.context)
      if (personGrouping === "PESSOA") target.personId = person.id
      return target
    }
    for (const person of input.population) groupOf(person).population.add(person.id)
    for (const fact of filtered) groupOf(people.get(fact.personId)!).facts.push(fact)
    // Rótulos iguais em grupos diferentes (homônimos): o Grupo/Subgrupo entra no rótulo; se ainda coincidir, um número de ordem.
    const sameLabel = new Map<string, Bucket[]>()
    for (const group of buckets.values()) sameLabel.set(group.label, [...(sameLabel.get(group.label) ?? []), group])
    for (const groups of sameLabel.values()) {
      if (groups.length < 2) continue
      const distinctContext = new Set(groups.map((group) => group.context)).size === groups.length
      groups.forEach((group, index) => {
        group.label = distinctContext && group.context ? `${group.label} (${group.context})` : `${group.label}${group.context ? ` (${group.context})` : ""} · ${index + 1}`
      })
    }
  } else {
    for (const fact of filtered) {
      const label = timeGrouping ? timeKey(timeGrouping, fact.dims.DIA ?? null) : fact.dims[dimension!.key] ?? null
      const target = bucket(label ?? "Não informado")
      target.facts.push(fact)
      target.population.add(fact.personId)
    }
  }

  const columns: QueryTableColumn[] = [{ key: "group", label: groupLabel, numeric: false }]
  if (personGrouping !== "PESSOA") columns.push({ key: "people", label: personGrouping || (!timeGrouping && !dimension) ? "Pessoas" : "Pessoas com registro", numeric: true })
  columns.push({ key: "records", label: "Registros", numeric: true })
  const cellKeys: { measure: MeasureSpec; statistic: Statistic; key: string }[] = []
  for (const measure of measures) {
    for (const statistic of statsFor(measure)) {
      if (personGrouping === "PESSOA" && (measure.kind === "COUNT_PER_PERSON" || measure.kind === "DISTINCT_PER_PERSON" || measure.kind === "ANY_PER_PERSON")) continue
      const key = `${measure.key}_${statistic}`
      cellKeys.push({ measure, statistic, key })
      columns.push({ key, label: `${measure.label} — ${STAT_LABELS[statistic]}`, numeric: true })
    }
  }

  const valuesOf = (measure: MeasureSpec, group: Bucket): number[] => {
    if (measure.kind === "ANY_PER_PERSON") {
      const withRecord = new Set(group.facts.map((fact) => fact.personId))
      return [...group.population].map((id) => (withRecord.has(id) ? 1 : 0))
    }
    if (measure.kind === "COUNT_PER_PERSON" || measure.kind === "DISTINCT_PER_PERSON") {
      const perPerson = new Map<string, Set<string> | number>([...group.population].map((id) => [id, measure.kind === "DISTINCT_PER_PERSON" ? new Set<string>() : 0]))
      for (const fact of group.facts) {
        const current = perPerson.get(fact.personId)
        if (measure.kind === "DISTINCT_PER_PERSON") (current as Set<string> | undefined ?? perPerson.set(fact.personId, new Set()).get(fact.personId) as Set<string>).add(fact.key ?? "")
        else perPerson.set(fact.personId, (typeof current === "number" ? current : 0) + 1)
      }
      return [...perPerson.values()].map((value) => (typeof value === "number" ? value : value.size))
    }
    return group.facts.map((fact) => fact.measures[measure.key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  }

  const kept = [...buckets.values()].filter((group) => group.facts.length >= input.minimumRecords)
  if (kept.length < buckets.size) limitations.push(`${buckets.size - kept.length} linhas com menos de ${input.minimumRecords} registros ficaram fora da tabela (amostra pequena); o total acima considera todas.`)
  const rowsWithKeys = kept.map((group) => {
    const cells: Record<string, string> = { group: group.label, people: String(group.population.size), records: String(group.facts.length) }
    let sortValue: number | null = null
    for (const { measure, statistic, key } of cellKeys) {
      const described = describe(valuesOf(measure, group))
      cells[key] = described ? formatStat(measure, statistic, described[statistic]) : "—"
      if (sortValue === null && described) sortValue = described[statistic]
    }
    return { row: { cells, subject: null, personId: group.personId } as QueryTableRow, sortValue }
  })
  const direction = input.sort.order === "asc" ? 1 : -1
  rowsWithKeys.sort((a, b) => {
    if (input.sort.by === "VALUE") {
      if (a.sortValue === null || b.sortValue === null) return a.sortValue === null ? (b.sortValue === null ? 0 : 1) : -1
      if (a.sortValue !== b.sortValue) return direction * (a.sortValue - b.sortValue)
      const byRecords = Number(b.row.cells.records) - Number(a.row.cells.records)
      if (byRecords !== 0) return byRecords
    }
    return a.row.cells.group!.localeCompare(b.row.cells.group!, "pt-BR")
  })

  // Total da estrutura (sempre): a mesma conta sobre a população inteira.
  const whole: Bucket = { label: "Total", context: "", personId: null, facts: filtered, population: new Set(input.population.map((person) => person.id)) }
  const totals = cellKeys.map(({ measure, statistic }) => {
    const described = describe(valuesOf(measure, whole))
    return `${measure.label} — ${STAT_LABELS[statistic]}: ${described ? formatStat(measure, statistic, described[statistic]) : "sem registro"}`
  })
  const highlights = [`Total do recorte: ${whole.population.size} pessoas, ${filtered.length} registros${totals.length > 0 ? `; ${totals.join("; ")}` : ""}.`]
  if (input.truncated) limitations.unshift("ATENÇÃO — RESULTADO PARCIAL: o período tem registros demais para uma consulta só; o cálculo usou apenas os registros mais antigos do período (corte em ordem de data) e os números abaixo NÃO são o total. Diga isso à pessoa e peça um período menor ou um recorte (Grupo, supervisor).")
  const limit = Math.min(MAX_FACT_ROWS, Math.max(1, input.limit))
  if (rowsWithKeys.length > limit) limitations.push(`A tabela mostra ${limit} de ${rowsWithKeys.length} linhas; o total acima considera todas.`)
  return buildCard(
    { structure: input.structure, source: "OFFICIAL", now: input.now },
    {
      title: `${input.domainTitle} por ${groupLabel.toLowerCase()}`,
      scopeNote: input.periodNote,
      period: null,
      indicatorCode: null,
      columns,
      rows: rowsWithKeys.slice(0, limit).map((item) => item.row),
      total: rowsWithKeys.length,
      methods: [...input.methods, "Estatísticas calculadas pelo sistema sobre todos os registros do recorte (mediana e percentis por interpolação; desvio padrão populacional). \"Por pessoa\" inclui com zero quem não tem registro."],
      limitations,
      highlights,
    },
  )
}

/** Teto do período de uma consulta de registros (o motor carrega os registros e calcula em memória). */
export const MAX_FACT_PERIOD_DAYS = 366

/** Data civil que existe no calendário (2026-02-31 e mês 13 não existem). */
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * Período pedido: competência (AAAA-MM) ou datas; padrão = última competência fechada. Datas civis no fuso da organização. Data ou
 * competência no formato certo mas que não existe no calendário é RECUSADA com mensagem (nunca chega ao banco); período de datas acima
 * de 12 meses também.
 */
export function resolveFactPeriod(args: { competencia?: unknown; data_inicio?: unknown; data_fim?: unknown }, lastClosedPeriod: string): { from: string; toExclusive: string; note: string } | { error: string } {
  const dateShaped = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const nextDay = (day: string) => {
    const date = new Date(`${day}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + 1)
    return date.toISOString().slice(0, 10)
  }
  const civil = (day: string) => day.split("-").reverse().join("/")
  if (dateShaped(args.data_inicio) || dateShaped(args.data_fim)) {
    if (!dateShaped(args.data_inicio) || !dateShaped(args.data_fim)) return { error: "Informe data_inicio e data_fim (AAAA-MM-DD)." }
    for (const value of [args.data_inicio, args.data_fim]) if (!isCivilDate(value)) return { error: `A data ${value} não existe no calendário. Corrija a data (AAAA-MM-DD) e consulte de novo.` }
    if (args.data_fim < args.data_inicio) return { error: "data_fim antes de data_inicio." }
    const days = Math.round((Date.parse(`${args.data_fim}T12:00:00Z`) - Date.parse(`${args.data_inicio}T12:00:00Z`)) / 86_400_000) + 1
    if (days > MAX_FACT_PERIOD_DAYS) return { error: `Período de ${days} dias: o máximo por consulta é de 12 meses (${MAX_FACT_PERIOD_DAYS} dias). Peça um período menor ou divida em mais de uma consulta.` }
    return { from: args.data_inicio, toExclusive: nextDay(args.data_fim), note: `${civil(args.data_inicio)} a ${civil(args.data_fim)}` }
  }
  const asked = typeof args.competencia === "string" && /^\d{4}-\d{2}$/.test(args.competencia) ? args.competencia : null
  if (asked && !isCivilDate(`${asked}-01`)) return { error: `A competência ${asked} não existe (o mês vai de 01 a 12). Corrija (AAAA-MM) e consulte de novo.` }
  const month = asked ?? lastClosedPeriod
  const [year, monthNumber] = month.split("-").map(Number) as [number, number]
  const next = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`
  return { from: `${month}-01`, toExclusive: `${next}-01`, note: `Mês ${month.split("-").reverse().join("/")}${month === lastClosedPeriod && typeof args.competencia !== "string" ? " (última competência fechada)" : ""}` }
}

export function parseStatistics(value: unknown): Statistic[] | null {
  if (!Array.isArray(value)) return null
  const parsed = value.map(String).filter((item): item is Statistic => (STATISTICS as readonly string[]).includes(item))
  return parsed.length > 0 ? parsed : null
}
export function parseStringList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 30) : []
}
