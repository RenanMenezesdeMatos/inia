import type { EmploymentFreshnessState } from "../../people/application/employment-status-freshness.js"
import type { EmploymentStatus } from "../../people/domain/employment-status.js"
import { HIERARCHY_ROLES } from "../../performance-analytics/domain/hierarchy-levels.js"

/**
 * MÉTRICAS GERENCIAIS de uma estrutura (aba "Dados da estrutura" do card de um líder no
 * organograma). Função PURA sobre a população estrutural já carregada — o SQL só traz linhas; toda
 * definição vive aqui, uma vez, e vale igual para o Postgres e para os fakes de teste.
 *
 * Definições oficiais (terminologia inequívoca, nunca avaliação):
 *  - POPULAÇÃO ESTRUTURAL (denominador único): cadastros ATIVOS abaixo do líder, em qualquer
 *    profundidade e de qualquer cargo — exatamente a regra que o resto da plataforma usa para
 *    "quem faz parte da estrutura" (`people.active`; `operatorsBelow`/`countActiveOperators`).
 *    Situação funcional NUNCA tira ninguém da estrutura: férias, INSS, maternidade, paternidade
 *    (e também transferido/aposentado com cadastro ainda ativo) continuam contando — eles só
 *    caem em outro bucket da distribuição.
 *  - SPAN DE CONTROLE: subordinados DIRETOS ativos (`reports_to_id`), de qualquer cargo. Nunca
 *    inferido pelo cargo (um operador que reporta a um Coordenador conta no span do Coordenador).
 *    Ausência temporária não altera o span.
 *  - ABRANGÊNCIA OPERACIONAL: operadores ativos abaixo do líder, em qualquer profundidade.
 *  - MÉDIA DA CAMADA: a partir das RELAÇÕES REAIS da subárvore — para cada par (cargo do gestor,
 *    cargo do subordinado) que existe de fato, `reports / managers`, onde `managers` = pessoas
 *    ativas com aquele cargo na subárvore e `reports` = subordinados diretos delas com o cargo
 *    do par. O próprio líder não entra como gestor (o par dele é o span).
 *  - REFERÊNCIA DO GRUPO: média do span dos pares de MESMO cargo e MESMO Grupo na organização
 *    (inclui o próprio líder) — informação descritiva, sem "bom/ruim/ideal".
 *  - SITUAÇÃO ATUAL: situação funcional vigente HOJE (data local da organização) pelo resolvedor
 *    canônico de períodos; sem período cobrindo a data, EM PRODUÇÃO presumido — que só vira
 *    "Não confirmado" quando a fonte de situação está ATRASADA (freshness STALE) e a data é
 *    posterior à última carga, o mesmo critério de `statusConfidence` da elegibilidade. FRESH e
 *    UNKNOWN (sem feed = legado/manual) nunca degradam, como no resto da plataforma.
 *  - PRIVACIDADE: INSS, maternidade e paternidade são potencialmente identificáveis em estruturas
 *    pequenas; abaixo de `MINIMUM_SENSITIVE_AGGREGATE_POPULATION` operadores eles são publicados só
 *    somados ("Afastamentos (motivo protegido)"), nunca um a um; o afastamento de um LÍDER fica
 *    sempre nesse bucket. Os buckets SEMPRE explicam o total.
 */
export const MINIMUM_SENSITIVE_AGGREGATE_POPULATION = 5

export const SENSITIVE_LEAVE_STATUSES = ["INSS", "MATERNIDADE", "PATERNIDADE"] as const satisfies readonly EmploymentStatus[]
export const isSensitiveLeave = (status: string | null): status is (typeof SENSITIVE_LEAVE_STATUSES)[number] => status !== null && (SENSITIVE_LEAVE_STATUSES as readonly string[]).includes(status)

/**
 * Os tipos sensíveis aparecem separados só quando a contagem não identifica ninguém (achado AI-04 da auditoria de 17/10/2026):
 * recorte com ao menos `MINIMUM_SENSITIVE_AGGREGATE_POPULATION` operadores E, entre os afastados sensíveis, ou nenhum, ou ao
 * menos dois tipos com 2+ pessoas cada. Com um tipo só (ou um caso isolado), a lista nominal "Afastamento (motivo protegido)"
 * do mesmo recorte entregaria o motivo de cada pessoa.
 * Alcance: o organograma e a consulta de força de trabalho. Não é garantia de que a liderança desconhece o tipo — o perfil ›
 * Indicadores, o Calendário da equipe e o aviso de conciliação mostram o tipo exato à liderança da cadeia por decisão de produto
 * (29/10/2026, R-37 em docs/security/pendencias-e-riscos.md).
 */
export function sensitiveBreakdownAllowed(population: number, statuses: readonly (string | null)[]): boolean {
  if (population < MINIMUM_SENSITIVE_AGGREGATE_POPULATION) return false
  const byType = new Map<string, number>()
  for (const status of statuses) if (isSensitiveLeave(status)) byType.set(status, (byType.get(status) ?? 0) + 1)
  if (byType.size === 0) return true
  return byType.size >= 2 && [...byType.values()].every((count) => count >= 2)
}

/**
 * O tipo só se separa para OPERADORES (achado C14 da 4ª auditoria, decisão de 29/10/2026): a regra acima olha só os operadores
 * do recorte, e o afastamento sensível de um LÍDER aparece sempre somado, como motivo protegido. Assim, subtrair recortes,
 * populações (com e sem líderes) ou datas nunca revela o tipo de um líder. Para operadores essa subtração continua possível e é
 * aceita: a liderança da cadeia já vê o tipo exato deles (N02 / R-37).
 */
export function leaveTypeVisible(person: { role: string }): boolean {
  return person.role === "OPERATOR"
}

export const DETAILED_STATUS_BUCKETS = ["EM_PRODUCAO", "FERIAS", "INSS", "MATERNIDADE", "PATERNIDADE"] as const satisfies readonly EmploymentStatus[]

export type StructureStatusBucket = (typeof DETAILED_STATUS_BUCKETS)[number] | "SENSITIVE_LEAVE" | "OTHER" | "UNCONFIRMED"

export type StructureStatusShare = {
  bucket: StructureStatusBucket
  count: number
  /** `count / structuralPopulation × 100`, 1 casa decimal — calculado AQUI, com o denominador único. */
  percent: number
}

export type LayerMetric = {
  managerRole: string
  reportRole: string
  managers: number
  reports: number
  /** `reports / managers`, 1 casa decimal. */
  average: number
}

export type GroupBenchmark = {
  groupId: string
  groupName: string
  peerRole: string
  /** Pares de mesmo cargo e mesmo Grupo na organização (inclui o próprio líder). */
  peerCount: number
  /** Média do span de controle dos pares, 1 casa decimal. */
  averageDirectSpan: number
}

export type ManagementMetrics = {
  /** Denominador único de todos os percentuais. */
  structuralPopulation: number
  /** Buckets em ordem de exibição; a soma dos `count` é SEMPRE `structuralPopulation`. */
  statusDistribution: StructureStatusShare[]
  directSpan: number
  operatorReach: number
  /** Cargos presentes na subárvore, na ordem real da cadeia ("4 Coordenadores · 20 Supervisores · 487 Operadores"). */
  roleCounts: Array<{ role: string; count: number }>
  layerMetrics: LayerMetric[]
  groupBenchmark: GroupBenchmark | null
  privacy: { sensitiveBreakdownSuppressed: boolean; minimumPopulation: number }
  confidence: { statusFreshness: EmploymentFreshnessState; unconfirmed: number }
}

export type StructureMemberRow = {
  id: string
  role: string
  reportsToId: string | null
  /** Situação canônica vigente na data local (legado já traduzido); null = código desconhecido. */
  status: EmploymentStatus | null
  /** true quando sustentada por um período (explícito ou em aberto); false = EM PRODUÇÃO presumido. */
  confirmed: boolean
}

export type StatusFreshnessInput = { state: EmploymentFreshnessState; lastSuccessLocalDate: string | null }

export type ManagementMetricsInput = {
  root: { id: string; role: string }
  /** População estrutural: ativos abaixo da raiz, qualquer profundidade (cada pessoa uma vez). */
  members: StructureMemberRow[]
  statusFreshness: StatusFreshnessInput
  /** Data local de hoje na organização (AAAA-MM-DD). */
  today: string
  groupBenchmark: GroupBenchmark | null
}

const ROLE_ORDER: readonly string[] = [...HIERARCHY_ROLES, "OPERATOR"]
const rank = (role: string) => {
  const index = ROLE_ORDER.indexOf(role)
  return index === -1 ? ROLE_ORDER.length : index
}

export function roundOne(value: number): number {
  return Math.round(value * 10) / 10
}

/** Situação presumida numa data posterior à última carga de uma fonte ATRASADA = não confirmada. */
export function isUnconfirmedStatus(member: Pick<StructureMemberRow, "confirmed">, freshness: StatusFreshnessInput, today: string): boolean {
  return freshness.state === "STALE" && !member.confirmed && (freshness.lastSuccessLocalDate === null || today > freshness.lastSuccessLocalDate)
}

export function computeManagementMetrics(input: ManagementMetricsInput): ManagementMetrics {
  const { root, members, statusFreshness, today } = input
  const population = members.length
  const operators = members.filter(leaveTypeVisible)
  const suppressed = !sensitiveBreakdownAllowed(operators.length, operators.filter((member) => !isUnconfirmedStatus(member, statusFreshness, today)).map((member) => member.status))

  // Distribuição de situação — cada pessoa cai em exatamente UM bucket.
  const counts = new Map<StructureStatusBucket, number>()
  const add = (bucket: StructureStatusBucket) => counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  let unconfirmed = 0
  for (const member of members) {
    if (isUnconfirmedStatus(member, statusFreshness, today)) {
      unconfirmed += 1
      add("UNCONFIRMED")
    } else if (isSensitiveLeave(member.status)) add(suppressed || !leaveTypeVisible(member) ? "SENSITIVE_LEAVE" : member.status)
    else if (member.status !== null && (DETAILED_STATUS_BUCKETS as readonly string[]).includes(member.status)) add(member.status as StructureStatusBucket)
    else add("OTHER")
  }
  const order: StructureStatusBucket[] = suppressed ? ["EM_PRODUCAO", "FERIAS", "SENSITIVE_LEAVE", "OTHER", "UNCONFIRMED"] : ["EM_PRODUCAO", "FERIAS", "INSS", "MATERNIDADE", "PATERNIDADE", "SENSITIVE_LEAVE", "OTHER", "UNCONFIRMED"]
  // Os cinco nomeados (ou "Afastamentos") aparecem sempre, mesmo com zero; Outras/Não confirmado — e, ao lado dos tipos, o
  // afastamento de líderes — só quando existem.
  const optional = (bucket: StructureStatusBucket) => bucket === "OTHER" || bucket === "UNCONFIRMED" || (bucket === "SENSITIVE_LEAVE" && !suppressed)
  const statusDistribution = order
    .filter((bucket) => !optional(bucket) || (counts.get(bucket) ?? 0) > 0)
    .map<StructureStatusShare>((bucket) => {
      const count = counts.get(bucket) ?? 0
      return { bucket, count, percent: population === 0 ? 0 : roundOne((count / population) * 100) }
    })

  // Span, abrangência e cargos.
  const directSpan = members.filter((member) => member.reportsToId === root.id).length
  const operatorReach = members.filter((member) => member.role === "OPERATOR").length
  const byRole = new Map<string, number>()
  for (const member of members) byRole.set(member.role, (byRole.get(member.role) ?? 0) + 1)
  const roleCounts = [...byRole.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([role, count]) => ({ role, count }))

  // Camadas a partir das relações reais: (cargo do gestor, cargo do subordinado) por edge da subárvore.
  const roleById = new Map(members.map((member) => [member.id, member.role]))
  const pairs = new Map<string, { managerRole: string; reportRole: string; reports: number }>()
  for (const member of members) {
    if (!member.reportsToId || member.reportsToId === root.id) continue
    const managerRole = roleById.get(member.reportsToId)
    if (managerRole === undefined) continue
    const key = `${managerRole}→${member.role}`
    const pair = pairs.get(key) ?? { managerRole, reportRole: member.role, reports: 0 }
    pair.reports += 1
    pairs.set(key, pair)
  }
  const layerMetrics = [...pairs.values()]
    .sort((a, b) => rank(a.managerRole) - rank(b.managerRole) || rank(a.reportRole) - rank(b.reportRole))
    .map<LayerMetric>((pair) => {
      const managers = byRole.get(pair.managerRole) ?? 0
      return { managerRole: pair.managerRole, reportRole: pair.reportRole, managers, reports: pair.reports, average: managers === 0 ? 0 : roundOne(pair.reports / managers) }
    })

  return {
    structuralPopulation: population,
    statusDistribution,
    directSpan,
    operatorReach,
    roleCounts,
    layerMetrics,
    groupBenchmark: input.groupBenchmark,
    privacy: { sensitiveBreakdownSuppressed: suppressed, minimumPopulation: MINIMUM_SENSITIVE_AGGREGATE_POPULATION },
    confidence: { statusFreshness: statusFreshness.state, unconfirmed },
  }
}
