import type { Database } from "../../../infrastructure/database/pool.js"
import { mapWithConcurrency } from "../../../shared/application/concurrency/map-with-concurrency.js"
import { loadIndicatorOperationalDefinition, resolveOperationalWindowBySubject, type OperationalWindowResult } from "../../indicators/application/operational-measurement-resolver.js"
import type { MeasurementAggregation } from "../../indicators/domain/operational-aggregation.js"
import { assignOperationalQuartiles, type OperationalQuartile } from "../../indicators/domain/operational-quartile.js"
import { coverageSatisfied, evaluateDataCondition, isDataCondition, percentageChange, resolveHistoricalResult, type EvaluationOptions, type OperationalEvidence } from "./condition-evaluator.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "./organization-timezone.js"
import { businessDaysInWindow, describePeriod, describeTimeWindow, resolvePreviousTimeWindow, resolveTimeWindow, type TimeWindow } from "./time-window.js"
import { resolveStructureAnchorOperatorIds } from "./hierarchy-subjects.js"
import { resolveEligibleOperatorIds, type WorkflowPopulation } from "./workflow-eligibility.js"
import type { ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import {
  findPrecedingCollectionNode,
  type EmployeeRankingConfig,
  type EmployeeRankingPartitionBy,
  type EmployeeSelectionCriterion,
  type FlowGraph,
  type HistoricalQuery,
} from "../domain/graph-schema.js"

/**
 * Candidatos avaliados ao mesmo tempo (critério da seleção e valores oficiais do Ranking, um a um). Cada avaliação faz as
 * próprias consultas; com `Promise.all` sobre milhares de candidatos, o pool (20 conexões por padrão, espera máxima de 10 s)
 * enfileirava tudo e quem passava da espera falhava — inclusive a renovação da posse das matrículas de OUTROS Workflows no
 * mesmo processo. Com 8 avaliações por vez (cada uma ainda dispara em paralelo as leituras de dias de trabalho), a fila do pool
 * fica em dezenas de consultas curtas em vez de milhares, e drena em milissegundos; o resultado é o mesmo, na mesma ordem.
 */
export const CANDIDATE_EVALUATION_CONCURRENCY = 8

/** Direção oficial de desempenho do indicador (`indicator_definitions.desired_direction`) — nunca
 * inferida do nome/código. Reaproveitado por vários módulos (action-executors.ts,
 * fetch-operator-overview.ts, etc.) — aqui só lida pra decidir o sentido de "Melhores"/"Piores"
 * e de "Evolução"/"Queda". */
export type IndicatorDirection = "HIGHER" | "LOWER" | "TARGET"

/** Posição de um colaborador no ranking, com o valor (VALUE) ou a evidência completa da
 * comparação (CHANGE: anterior/atual/variação matemática/variação de performance já normalizada
 * pela direção) que determinou a posição — evidência suficiente pra mostrar "1º João — 72,1" ou
 * "1º João — 90 → 72 — queda de 20%" sem recalcular depois (Parte 23/34/35/47/48 do pedido). */
export type RankedMember = (
  | { employeeId: string; value: number; position: number }
  | { employeeId: string; previousValue: number; currentValue: number; change: number; performanceChange: number; position: number }
) & {
  /** Só selection OPERATIONAL_QUARTILE: quartil OPERACIONAL do colaborador na população do balde (nunca o oficial). */
  operationalQuartile?: OperationalQuartile
  /** Só MEASUREMENT (camada operacional): como o valor foi formado — janela, método, amostra. */
  evidence?: OperationalEvidence
  previousEvidence?: OperationalEvidence
}

/** Como o balde foi calculado — QA mostra sempre janela, população, fonte e método, nunca só "Q4". */
export type RankingCalculation = {
  source: "MEASUREMENT" | "INDICATOR_ACHIEVEMENT" | "PRV_ACHIEVEMENT"
  indicatorCode: string | null
  aggregation: string
  periodLabel: string
  windowLabel: string | null
  previousWindowLabel: string | null
  direction: IndicatorDirection | null
  /** Só quartil operacional: quantos foram ranqueados e por que ninguém foi classificado (população < 4). */
  quartileReason?: "OK" | "INSUFFICIENT_POPULATION" | "DIRECTION_UNSUPPORTED"
  /** Cobertura mínima configurada (fração) — quem ficou abaixo está em `noDataCount`. */
  minimumCoverage: number | null
}

/** Um "balde" do ranking — sem partição (Parte 25: `partitionBy: "NONE"`) existe exatamente UM,
 * com `id`/`name` nulos; com partição, um por Grupo/Subgrupo realmente ocupado pelos candidatos
 * (nunca todos os grupos da organização — só os que têm gente nesta execução), mais um bucket
 * explícito "Sem grupo"/"Sem subgrupo" quando aplicável (Parte 32: nunca descarta silenciosamente
 * quem não tem `team_id`/`subteam_id` — é um estado real e válido no domínio, não um erro). */
export type RankingPartition = {
  id: string | null
  name: string | null
  evaluatedCount: number
  rankedCount: number
  noDataCount: number
  selectedCount: number
  members: RankedMember[]
  calculation?: RankingCalculation
}

/**
 * O que "Selecionar colaboradores" grava em `node_outputs[nodeId]` — a coleção fica congelada
 * ali pro resto desta execução (nunca recalculada). União discriminada por `mode` (Parte 33/65 do
 * pedido de Ranking): CONDITION preserva EXATAMENTE o formato de sempre (zero regressão — dado
 * publicado antes desta evolução, sem `mode` nenhum, é lido via cast em vez de `zod.parse` em
 * todos os pontos de leitura — cai neste mesmo ramo, nunca quebra). RANKING é o formato novo:
 * `partitions` está SEMPRE presente (mesmo sem separação — um balde só, Parte 44/45/46) — nunca
 * um `ranked` achatado em paralelo, pra não ter 2 formas de ler o mesmo resultado.
 */
type EmployeeCollectionOutputBase = {
  kind: "EMPLOYEE_COLLECTION"
  memberIds: string[]
  evaluatedCount: number
  selectedCount: number
  sourceKind: "STRUCTURE" | "EMPLOYEE_COLLECTION"
  sourceNodeId: string | null
  selectedAt: string
}
export type EmployeeCollectionOutput =
  | (EmployeeCollectionOutputBase & {
      mode: "CONDITION"
      criterion: EmployeeSelectionCriterion
      notMatchedCount: number
      noDataCount: number
    })
  | (EmployeeCollectionOutputBase & {
      mode: "RANKING"
      ranking: EmployeeRankingConfig
      direction: IndicatorDirection | null
      partitionBy: EmployeeRankingPartitionBy
      requestedCountPerPartition: number
      rankedCount: number
      noDataCount: number
      partitions: RankingPartition[]
    })

/**
 * População candidata de um "Selecionar colaboradores": Estrutura Consolidada ∩ Abrangência ∩
 * Filtro Populacional (primeira seleção, `sourceKind: "STRUCTURE"`) — reaproveita
 * `resolveStructureAnchorOperatorIds` (mesma resolução de estrutura que a Condition agregada já
 * usa) e `resolveEligibleOperatorIds` (mesma elegibilidade que Agenda/ingestão já usam), nenhuma
 * função nova de população. Ou os membros da coleção mais próxima (refinamento,
 * `sourceKind: "EMPLOYEE_COLLECTION"`) — NUNCA reconsulta estrutura/elegibilidade, garantindo
 * que um segundo filtro nunca reexpande pra além do que o primeiro já selecionou.
 */
export async function resolveSelectionCandidates(
  db: Database,
  graph: FlowGraph,
  nodeId: string,
  organizationId: string,
  consolidatedStructure: ConsolidatedStructure,
  population: WorkflowPopulation,
  anchorId: string | null,
  nodeOutputs: Record<string, unknown>,
): Promise<{ candidateIds: string[]; sourceKind: "STRUCTURE" | "EMPLOYEE_COLLECTION"; sourceNodeId: string | null }> {
  const previous = findPrecedingCollectionNode(graph, nodeId)
  if (previous) {
    const stored = nodeOutputs[previous.id] as EmployeeCollectionOutput | undefined
    return { candidateIds: stored?.memberIds ?? [], sourceKind: "EMPLOYEE_COLLECTION", sourceNodeId: previous.id }
  }
  const [structureMembers, eligible] = await Promise.all([
    resolveStructureAnchorOperatorIds(db, consolidatedStructure, anchorId),
    resolveEligibleOperatorIds(db, organizationId, population),
  ])
  const eligibleSet = new Set(eligible)
  return { candidateIds: structureMembers.filter((id) => eligibleSet.has(id)), sourceKind: "STRUCTURE", sourceNodeId: null }
}

/**
 * Roda o critério — a MESMA engine determinística de Conditions (`evaluateDataCondition`,
 * condition-evaluator.ts), nunca uma segunda implementação — pra CADA candidato,
 * INDIVIDUALMENTE (`subjectIds: [candidateId]`, nunca agregado: a pergunta é "ESTA pessoa
 * atende?", não "a média do grupo atende?"). Zero chamada de IA (Parte 6/55/79 do pedido).
 * TRUE entra na coleção; FALSE e SEM DADOS ficam fora, mas contados separadamente pra
 * explicabilidade (Parte 8/37) — nunca uma 4ª opção "incluir sem dados" (Parte 38).
 */
export async function runEmployeeSelection(
  db: Database,
  criterion: EmployeeSelectionCriterion,
  candidateIds: string[],
  now: Date,
  options: EvaluationOptions = {},
): Promise<{ memberIds: string[]; notMatchedCount: number; noDataCount: number }> {
  if (!isDataCondition(criterion)) {
    throw new Error(`Critério de seleção sem consulta configurada (histórico ou performance).`)
  }
  const sharedOptions: EvaluationOptions = { ...options, quartileCache: options.quartileCache ?? new Map() }
  // `populationIds`: o critério de quartil operacional é relativo a ESTES candidatos (a
  // população do nó), nunca à empresa — mesma população que o Ranking usaria aqui.
  const evaluations = await mapWithConcurrency(candidateIds, CANDIDATE_EVALUATION_CONCURRENCY, (candidateId) =>
    evaluateDataCondition(db, criterion, { operatorId: candidateId, subjectIds: [candidateId], populationIds: candidateIds }, now, sharedOptions),
  )
  const memberIds: string[] = []
  let notMatchedCount = 0
  let noDataCount = 0
  evaluations.forEach((evaluation, index) => {
    if (!evaluation || evaluation.branch === "false") {
      notMatchedCount++
    } else if (evaluation.branch === "no_data") {
      noDataCount++
    } else {
      memberIds.push(candidateIds[index]!)
    }
  })
  return { memberIds, notMatchedCount, noDataCount }
}

/**
 * Direção oficial usada só por "Melhores"/"Piores" (Parte 9/10/41 do pedido) — NUNCA por
 * "Maiores"/"Menores" (puramente matemáticos, Parte 12, nunca consultam isto). Atingimento
 * (indicador ou PRV) já vem normalizado da fonte externa — maior percentual é sempre melhor, por
 * construção — então nunca consulta `indicator_definitions` pra essas origens (mesma convenção já
 * usada por Quartil: "Q1=melhor, Q4=pior, sempre"). Só Valor bruto (MEASUREMENT) depende do
 * indicador específico — usa a ÚNICA fonte oficial de direção do sistema,
 * `indicator_definitions.desired_direction` (HIGHER/LOWER/TARGET, coluna NOT NULL desde a
 * migration 001, já reaproveitada por action-executors.ts/fetch-operator-overview.ts/
 * supervisor-router.ts) — nunca inferida do nome/código do indicador. `null` = indicador não
 * encontrado (defesa em runtime; publish já bloqueia isso antes, ver workflow-router.ts).
 */
async function resolveRankingDirection(
  db: Database,
  organizationId: string,
  ranking: Pick<EmployeeRankingConfig, "source" | "indicatorCode">,
): Promise<IndicatorDirection | null> {
  const source = ranking.source ?? "MEASUREMENT"
  if (source !== "MEASUREMENT") return "HIGHER"
  const result = await db.query<{ desired_direction: IndicatorDirection }>(
    `select desired_direction from indicator_definitions where code = $1 and organization_id = $2`,
    [ranking.indicatorCode, organizationId],
  )
  return result.rows[0]?.desired_direction ?? null
}

type ValueRow = { employeeId: string; value: number; evidence?: OperationalEvidence }
type ChangeRow = { employeeId: string; previousValue: number; currentValue: number; change: number; performanceChange: number; evidence?: OperationalEvidence; previousEvidence?: OperationalEvidence }

function isOperationalRanking(ranking: EmployeeRankingConfig): boolean {
  return (ranking.source ?? "MEASUREMENT") === "MEASUREMENT" && ranking.period?.kind !== "CLOSURES"
}

function toMemberEvidence(result: OperationalWindowResult, window: TimeWindow, timeZone: string, minimumCoverage?: number): OperationalEvidence {
  return {
    windowLabel: describeTimeWindow(window, timeZone),
    aggregation: result.aggregation,
    aggregationKind: result.kind,
    method: result.method,
    sampleCount: result.sampleCount,
    daysWithData: result.daysWithData,
    expectedDays: result.expectedDays,
    coverage: result.coverage,
    minimumCoverage: minimumCoverage ?? null,
    coverageSatisfied: coverageSatisfied(result.coverage, minimumCoverage),
    numerator: result.numerator,
    denominator: result.denominator,
    sampleTotal: result.sampleTotal,
  }
}

/**
 * Resolve o valor agregado de cada candidato (`rankingBasis: "VALUE"`). Medição operacional
 * (MEASUREMENT + janela): UMA query em lote pra todos os candidatos, pelo MESMO resolvedor da
 * Condition (`resolveOperationalWindowBySubject` — mesma janela, mesma agregação, mesma
 * matemática), nunca N+1 (Parte 104). Fontes oficiais/fechamentos continuam pelo
 * `resolveHistoricalResult` candidato a candidato (fechamentos mensais, volume pequeno). Quem
 * não tem valor válido no período fica fora — nunca entra como "pior" por omissão.
 */
async function resolveValues(db: Database, ranking: EmployeeRankingConfig, candidateIds: string[], now: Date, timeZone: string): Promise<ValueRow[]> {
  if (isOperationalRanking(ranking)) {
    const window = resolveTimeWindow(ranking.period!, now, timeZone)
    const bySubject = await resolveOperationalWindowBySubject(db, { indicatorCode: ranking.indicatorCode!, subjectIds: candidateIds, window, aggregation: ranking.aggregation as MeasurementAggregation, expectedDays: businessDaysInWindow(window, timeZone), timeZone })
    // Cobertura abaixo do mínimo configurado = fora do ranking como SEM DADOS (nunca "pior" por omissão).
    return candidateIds.flatMap((employeeId) => {
      const result = bySubject.get(employeeId)
      if (!result || result.value === null || coverageSatisfied(result.coverage, ranking.minimumCoverage) === false) return []
      return [{ employeeId, value: result.value, evidence: toMemberEvidence(result, window, timeZone, ranking.minimumCoverage) }]
    })
  }
  const query: HistoricalQuery = { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: ranking.indicatorCode, aggregation: ranking.aggregation, source: ranking.source, period: ranking.period }
  const resolved = await mapWithConcurrency(candidateIds, CANDIDATE_EVALUATION_CONCURRENCY, async (employeeId) => {
    const result = await resolveHistoricalResult(db, [employeeId], query, now, { timeZone })
    return { employeeId, value: result.kind === "aggregate" ? result.value : null }
  })
  return resolved.filter((row): row is ValueRow => row.value !== null)
}

/**
 * Resolve a variação MATEMÁTICA (`change`, nunca ainda a de performance) de cada candidato entre
 * o período atual (`ranking.period`) e o período anterior EQUIVALENTE — a MESMA fórmula da
 * Condition (`percentageChange`: (atual−anterior)/anterior×100, anterior zero = SEM DADOS) e as
 * MESMAS janelas (time-window.ts). Medição operacional: duas queries em lote (janela atual e
 * anterior) pra todos os candidatos; fontes oficiais: `resolveHistoricalResult` com
 * `compareTo: PREVIOUS_PERIOD`, candidato a candidato. Os 3 motivos de SEM DADOS — atual
 * ausente, anterior ausente, anterior=0 — deixam o candidato fora do ranking.
 */
async function resolveChangeValues(db: Database, ranking: EmployeeRankingConfig, candidateIds: string[], now: Date, timeZone: string): Promise<ChangeRow[]> {
  if (isOperationalRanking(ranking)) {
    const window = resolveTimeWindow(ranking.period!, now, timeZone)
    const previousWindow = resolvePreviousTimeWindow(ranking.period!, now, timeZone)
    const definition = await loadIndicatorOperationalDefinition(db, ranking.indicatorCode!)
    const input = { indicatorCode: ranking.indicatorCode!, subjectIds: candidateIds, aggregation: ranking.aggregation as MeasurementAggregation, timeZone }
    const [current, previous] = await Promise.all([
      resolveOperationalWindowBySubject(db, { ...input, window, expectedDays: businessDaysInWindow(window, timeZone) }, definition ?? undefined),
      resolveOperationalWindowBySubject(db, { ...input, window: previousWindow, expectedDays: businessDaysInWindow(previousWindow, timeZone) }, definition ?? undefined),
    ])
    return candidateIds.flatMap((employeeId) => {
      const now_ = current.get(employeeId)
      const before = previous.get(employeeId)
      if (!now_ || !before || now_.value === null || before.value === null) return []
      if (coverageSatisfied(now_.coverage, ranking.minimumCoverage) === false || coverageSatisfied(before.coverage, ranking.minimumCoverage) === false) return []
      const change = percentageChange(now_.value, before.value)
      if (change === null) return []
      return [{ employeeId, previousValue: before.value, currentValue: now_.value, change, performanceChange: change, evidence: toMemberEvidence(now_, window, timeZone, ranking.minimumCoverage), previousEvidence: toMemberEvidence(before, previousWindow, timeZone, ranking.minimumCoverage) }]
    })
  }
  const query: HistoricalQuery = {
    kind: "INDICATOR_THRESHOLD_COUNT",
    indicatorCode: ranking.indicatorCode,
    aggregation: ranking.aggregation,
    source: ranking.source,
    period: ranking.period,
    compareTo: { kind: "PREVIOUS_PERIOD", changeMode: "PERCENT" },
  }
  const resolved = await mapWithConcurrency(candidateIds, CANDIDATE_EVALUATION_CONCURRENCY, async (employeeId) => {
    const result = await resolveHistoricalResult(db, [employeeId], query, now, { timeZone })
    if (result.kind !== "aggregate" || result.value === null || result.previousValue === undefined || result.comparisonValue === undefined) return null
    return { employeeId, previousValue: result.previousValue, currentValue: result.value, change: result.comparisonValue }
  })
  return resolved.filter((row): row is Omit<ChangeRow, "performanceChange"> => row !== null).map((row) => ({ ...row, performanceChange: row.change }))
}

/** Metadata de cálculo do balde (QA: janela, população, fonte, método — nunca só "Q4"). */
function describeCalculation(ranking: EmployeeRankingConfig, direction: IndicatorDirection | null, now: Date, timeZone: string): RankingCalculation {
  const operational = isOperationalRanking(ranking)
  return {
    source: ranking.source ?? "MEASUREMENT",
    indicatorCode: ranking.indicatorCode ?? null,
    aggregation: ranking.aggregation ?? "AVERAGE",
    periodLabel: ranking.period ? describePeriod(ranking.period) : "?",
    windowLabel: operational ? describeTimeWindow(resolveTimeWindow(ranking.period!, now, timeZone), timeZone) : null,
    previousWindowLabel: operational && ranking.rankingBasis === "CHANGE" ? describeTimeWindow(resolvePreviousTimeWindow(ranking.period!, now, timeZone), timeZone) : null,
    direction,
    minimumCoverage: operational ? (ranking.minimumCoverage ?? null) : null,
  }
}

function withEvidence(member: RankedMember, row: ValueRow | ChangeRow): RankedMember {
  return { ...member, ...(row.evidence ? { evidence: row.evidence } : {}), ...("previousEvidence" in row && row.previousEvidence ? { previousEvidence: row.previousEvidence } : {}) }
}

/**
 * Seleção por QUARTIL OPERACIONAL dentro de UM balde (Parte 45–48): classifica TODA a população
 * com valor pela direção oficial (indicators/domain/operational-quartile.ts — Q1 = melhor 25%,
 * Q4 = pior 25%, empates na mesma posição, mínimo de 4 ranqueados) e devolve os do quartil
 * pedido. O quartil é relativo a ESTA população (o balde: a estrutura/abrangência do workflow ou
 * a coleção anterior) — Q4 de uma equipe de supervisor nunca é comparável com Q4 de uma gerência.
 */
function selectOperationalQuartile(rows: ValueRow[], direction: IndicatorDirection, quartile: OperationalQuartile): { members: RankedMember[]; reason: "OK" | "INSUFFICIENT_POPULATION" | "DIRECTION_UNSUPPORTED" } {
  const result = assignOperationalQuartiles(rows.map((row) => ({ employeeId: row.employeeId, value: row.value })), direction)
  const byId = new Map(rows.map((row) => [row.employeeId, row]))
  const members = result.assignments
    .filter((assignment) => assignment.quartile === quartile)
    .map((assignment) => withEvidence({ employeeId: assignment.employeeId, value: assignment.value, position: assignment.position, operationalQuartile: assignment.quartile! }, byId.get(assignment.employeeId)!))
  return { members, reason: result.reason }
}

/** Ordena/corta o ranking VALUE dentro de UM balde — mesma lógica de sempre (Parte 25/26 do
 * pedido original: corte estrito, desempate por `employeeId` ascendente, estável e determinístico
 * pro mesmo snapshot). */
function selectValueRanking(rows: ValueRow[], selection: "HIGHEST" | "LOWEST" | "BEST" | "WORST", direction: IndicatorDirection | null, count: number): RankedMember[] {
  // HIGHEST -> desc | LOWEST -> asc | BEST+HIGHER -> desc | BEST+LOWER -> asc | WORST+HIGHER -> asc | WORST+LOWER -> desc
  const descending = selection === "HIGHEST" || (selection === "BEST" && direction === "HIGHER") || (selection === "WORST" && direction === "LOWER")
  const sorted = [...rows].sort((a, b) => (descending ? b.value - a.value : a.value - b.value) || a.employeeId.localeCompare(b.employeeId))
  return sorted.slice(0, count).map((row, index) => ({ employeeId: row.employeeId, value: row.value, position: index + 1 }))
}

/**
 * Filtra/ordena/corta o ranking CHANGE dentro de UM balde (Parte 13/14/15/16/17 do pedido de
 * Evolução/Queda) — IMPROVED exige `performanceChange > 0` (nunca "quem piorou menos"), DECLINED
 * exige `performanceChange < 0` (nunca "quem melhorou menos"); `performanceChange === 0` não
 * entra em nenhum dos dois (Parte 17: não é evolução nem queda). Ordena pela maior melhora (desc)
 * ou pela maior piora (asc — mais negativo primeiro), desempate por `employeeId` ascendente.
 */
function selectChangeRanking(rows: ChangeRow[], selection: "IMPROVED" | "DECLINED", count: number): RankedMember[] {
  const filtered = selection === "IMPROVED" ? rows.filter((row) => row.performanceChange > 0) : rows.filter((row) => row.performanceChange < 0)
  const sorted = [...filtered].sort((a, b) => {
    const primary = selection === "IMPROVED" ? b.performanceChange - a.performanceChange : a.performanceChange - b.performanceChange
    return primary || a.employeeId.localeCompare(b.employeeId)
  })
  return sorted
    .slice(0, count)
    .map((row, index) => ({ employeeId: row.employeeId, previousValue: row.previousValue, currentValue: row.currentValue, change: row.change, performanceChange: row.performanceChange, position: index + 1 }))
}

type PartitionKey = { id: string | null; name: string | null }

/**
 * Resolve a que balde (Grupo/Subgrupo) cada candidato pertence — UMA query batched pra todos os
 * candidatos de uma vez (Parte 102 do pedido: nunca uma query por grupo). `people.team_id`/
 * `people.subteam_id` são colunas singulares e nullable (auditado em workflow-eligibility.ts) —
 * um colaborador pertence a no máximo um Grupo e um Subgrupo. Quem não tem o campo preenchido
 * (Parte 32) NÃO é descartado silenciosamente: vira o bucket explícito "Sem grupo"/"Sem
 * subgrupo" (`id` sentinela estável, nunca `null` — `null` é reservado pro caso `partitionBy:
 * "NONE"`, o balde único implícito, pra nunca confundir os dois).
 */
export const NO_PARTITION_ID = "__NO_GROUP__"

async function resolvePartitionKeys(db: Database, candidateIds: string[], partitionBy: EmployeeRankingPartitionBy): Promise<Map<string, PartitionKey>> {
  if (partitionBy === "NONE" || candidateIds.length === 0) {
    return new Map(candidateIds.map((id) => [id, { id: null, name: null }]))
  }
  const noPartitionLabel = partitionBy === "TEAM" ? "Sem grupo" : "Sem subgrupo"
  const result =
    partitionBy === "TEAM"
      ? await db.query<{ id: string; partitionId: string | null; partitionName: string | null }>(
          `select p.id, p.team_id "partitionId", t.name "partitionName" from people p left join teams t on t.id = p.team_id where p.id = any($1::uuid[])`,
          [candidateIds],
        )
      : await db.query<{ id: string; partitionId: string | null; partitionName: string | null }>(
          `select p.id, p.subteam_id "partitionId", st.name "partitionName" from people p left join subteams st on st.id = p.subteam_id where p.id = any($1::uuid[])`,
          [candidateIds],
        )
  const map = new Map<string, PartitionKey>()
  for (const row of result.rows) {
    map.set(row.id, row.partitionId ? { id: row.partitionId, name: row.partitionName } : { id: NO_PARTITION_ID, name: noPartitionLabel })
  }
  return map
}

type Bucket = { id: string | null; name: string | null; candidateIds: string[] }

/** Agrupa os candidatos em baldes a partir de `resolvePartitionKeys`, em memória (Parte 102 —
 * particionar nunca reconsulta a população). Ordem determinística por NOME (Parte 26/89: nunca
 * pela ordem de chegada do banco, que não é garantida) — "Sem grupo"/"Sem subgrupo" sempre por
 * último; sem partição há sempre exatamente 1 balde, ordem irrelevante. */
function buildBuckets(candidateIds: string[], partitionKeys: Map<string, PartitionKey>): Bucket[] {
  const buckets = new Map<string, Bucket>()
  const order: string[] = []
  for (const employeeId of candidateIds) {
    const key = partitionKeys.get(employeeId) ?? { id: null, name: null }
    const bucketKey = key.id ?? "\u0000NONE"
    let bucket = buckets.get(bucketKey)
    if (!bucket) {
      bucket = { id: key.id, name: key.name, candidateIds: [] }
      buckets.set(bucketKey, bucket)
      order.push(bucketKey)
    }
    bucket.candidateIds.push(employeeId)
  }
  order.sort((a, b) => {
    const nameA = buckets.get(a)!.name
    const nameB = buckets.get(b)!.name
    if (nameA === null && nameB === null) return 0
    if (nameA === null) return 1
    if (nameB === null) return -1
    return nameA.localeCompare(nameB)
  })
  return order.map((key) => buckets.get(key)!)
}

export type RankingResult = {
  memberIds: string[]
  direction: IndicatorDirection | null
  partitionBy: EmployeeRankingPartitionBy
  requestedCountPerPartition: number
  rankedCount: number
  noDataCount: number
  partitions: RankingPartition[]
}

/**
 * Resolve o ranking — VALUE (comportamento original) ou CHANGE (evolução de Evolução/Queda,
 * Parte 1 desta rodada), opcionalmente particionado por Grupo/Subgrupo (Parte 24). Zero chamada
 * de IA (Parte 4 original). `count` é SEMPRE por balde (Parte 26: sem partição, 1 balde = mesmo
 * comportamento de sempre; com partição, N por Grupo/Subgrupo, nunca N total).
 */
export async function runEmployeeRanking(db: Database, organizationId: string, ranking: EmployeeRankingConfig, candidateIds: string[], now: Date, options: EvaluationOptions = {}): Promise<RankingResult> {
  const timeZone = options.timeZone ?? DEFAULT_ORGANIZATION_TIMEZONE
  if (!ranking.aggregation) throw new Error(`Configuração de ranking sem agregação (Média, Mínimo ou Máximo).`)
  if (!ranking.period) throw new Error(`Configuração de ranking sem período.`)
  if (!ranking.selection) throw new Error(`Configuração de ranking sem direção de seleção.`)
  if (ranking.selection !== "OPERATIONAL_QUARTILE" && (!ranking.count || ranking.count <= 0)) throw new Error(`Configuração de ranking sem quantidade válida.`)

  const basis = ranking.rankingBasis === "CHANGE" ? "CHANGE" : "VALUE"
  const partitionBy: EmployeeRankingPartitionBy = ranking.partitionBy ?? "NONE"
  const partitionKeys = await resolvePartitionKeys(db, candidateIds, partitionBy)
  const buckets = buildBuckets(candidateIds, partitionKeys)

  if (basis === "CHANGE") {
    if (ranking.selection !== "IMPROVED" && ranking.selection !== "DECLINED") {
      throw new Error(`Configuração de ranking de Evolução com uma direção de seleção inválida — use Maiores evoluções ou Maiores quedas.`)
    }
    // "Últimos N fechamentos" não tem período anterior equivalente resolvível corretamente —
    // resolveHistoricalResult já lançaria em runtime, mas falhar aqui dá uma mensagem amigável
    // (Parte 7 do pedido: nunca oferecer/aceitar um período sem comparação suportada).
    if (ranking.period.kind === "CLOSURES") {
      throw new Error(`"Evolução"/"Queda" não está disponível para "Últimos N fechamentos" — escolha um período com comparação ao período anterior suportada.`)
    }
    const changeRows = await resolveChangeValues(db, ranking, candidateIds, now, timeZone)
    const direction = await resolveRankingDirection(db, organizationId, ranking)
    if (direction === null || direction === "TARGET") {
      throw new Error(
        `"Evolução"/"Queda" não está disponível para este indicador — precisa de uma direção de desempenho oficial HIGHER ou LOWER (indicadores com direção TARGET não são suportados nesta V1).`,
      )
    }
    const withPerformance = changeRows.map((row) => ({ ...row, performanceChange: direction === "LOWER" ? -row.change : row.change }))
    const byEmployeeId = new Map(withPerformance.map((row) => [row.employeeId, row]))
    let rankedCount = 0
    let noDataCount = 0
    const partitions: RankingPartition[] = buckets.map((bucket) => {
      const rows = bucket.candidateIds.map((id) => byEmployeeId.get(id)).filter((row): row is ChangeRow => row !== undefined)
      const bucketNoData = bucket.candidateIds.length - rows.length
      rankedCount += rows.length
      noDataCount += bucketNoData
      const members = selectChangeRanking(rows, ranking.selection as "IMPROVED" | "DECLINED", ranking.count!).map((member) => withEvidence(member, byEmployeeId.get(member.employeeId)!))
      return { id: bucket.id, name: bucket.name, evaluatedCount: bucket.candidateIds.length, rankedCount: rows.length, noDataCount: bucketNoData, selectedCount: members.length, members, calculation: describeCalculation(ranking, direction, now, timeZone) }
    })
    return {
      memberIds: partitions.flatMap((p) => p.members.map((m) => m.employeeId)),
      direction,
      partitionBy,
      requestedCountPerPartition: ranking.count ?? 0,
      rankedCount,
      noDataCount,
      partitions,
    }
  }

  if (ranking.selection === "OPERATIONAL_QUARTILE") {
    if (!isOperationalRanking(ranking)) throw new Error(`Quartil operacional só está disponível para Valor do indicador (medição operacional) com uma janela de período — nunca para fechamentos oficiais.`)
    if (!ranking.operationalQuartile) throw new Error(`Configuração de quartil operacional sem o quartil a selecionar (Q1..Q4).`)
    const direction = await resolveRankingDirection(db, organizationId, ranking)
    if (direction === null || direction === "TARGET") {
      throw new Error(`Quartil operacional não está disponível para este indicador — precisa de uma direção de desempenho oficial HIGHER ou LOWER (indicadores TARGET não têm regra de classificação).`)
    }
    const valueRows = await resolveValues(db, ranking, candidateIds, now, timeZone)
    const byEmployeeId = new Map(valueRows.map((row) => [row.employeeId, row]))
    let rankedCount = 0
    let noDataCount = 0
    const partitions: RankingPartition[] = buckets.map((bucket) => {
      const rows = bucket.candidateIds.map((id) => byEmployeeId.get(id)).filter((row): row is ValueRow => row !== undefined)
      const bucketNoData = bucket.candidateIds.length - rows.length
      rankedCount += rows.length
      noDataCount += bucketNoData
      const { members, reason } = selectOperationalQuartile(rows, direction, ranking.operationalQuartile!)
      return { id: bucket.id, name: bucket.name, evaluatedCount: bucket.candidateIds.length, rankedCount: rows.length, noDataCount: bucketNoData, selectedCount: members.length, members, calculation: { ...describeCalculation(ranking, direction, now, timeZone), quartileReason: reason } }
    })
    return {
      memberIds: partitions.flatMap((p) => p.members.map((m) => m.employeeId)),
      direction,
      partitionBy,
      requestedCountPerPartition: ranking.count ?? 0,
      rankedCount,
      noDataCount,
      partitions,
    }
  }

  if (ranking.selection !== "HIGHEST" && ranking.selection !== "LOWEST" && ranking.selection !== "BEST" && ranking.selection !== "WORST") {
    throw new Error(`Configuração de ranking de Valor com uma direção de seleção inválida.`)
  }
  const valueRows = await resolveValues(db, ranking, candidateIds, now, timeZone)
  const usesDirection = ranking.selection === "BEST" || ranking.selection === "WORST"
  const direction = usesDirection ? await resolveRankingDirection(db, organizationId, ranking) : null
  if (usesDirection && (direction === null || direction === "TARGET")) {
    throw new Error(
      `"Melhores"/"Piores" não está disponível para este indicador — não há direção de desempenho oficial definida (meta por faixa/alvo). Use "Maiores valores"/"Menores valores".`,
    )
  }
  const byEmployeeId = new Map(valueRows.map((row) => [row.employeeId, row]))
  let rankedCount = 0
  let noDataCount = 0
  const partitions: RankingPartition[] = buckets.map((bucket) => {
    const rows = bucket.candidateIds.map((id) => byEmployeeId.get(id)).filter((row): row is ValueRow => row !== undefined)
    const bucketNoData = bucket.candidateIds.length - rows.length
    rankedCount += rows.length
    noDataCount += bucketNoData
    const members = selectValueRanking(rows, ranking.selection as "HIGHEST" | "LOWEST" | "BEST" | "WORST", direction, ranking.count!).map((member) => withEvidence(member, byEmployeeId.get(member.employeeId)!))
    return { id: bucket.id, name: bucket.name, evaluatedCount: bucket.candidateIds.length, rankedCount: rows.length, noDataCount: bucketNoData, selectedCount: members.length, members, calculation: describeCalculation(ranking, direction, now, timeZone) }
  })
  return {
    memberIds: partitions.flatMap((p) => p.members.map((m) => m.employeeId)),
    direction,
    partitionBy,
    requestedCountPerPartition: ranking.count ?? 0,
    rankedCount,
    noDataCount,
    partitions,
  }
}
