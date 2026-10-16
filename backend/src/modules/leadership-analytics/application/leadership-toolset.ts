import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import type { AnalyticsReadRepository, IndicatorDefinitionRow } from "../../performance-analytics/application/analytics-read-repository.js"
import type { OperationalComparison } from "../../performance-analytics/domain/operational-comparison.js"
import { referencePeriodWindow } from "../../performance-analytics/domain/reference-period.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { isGroupingDimension } from "../../performance-analytics/domain/hierarchy-levels.js"
import type { MemberSituation } from "../../performance-analytics/domain/view-models.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { IndicatorAnalysisCard, LeadershipCard, PeopleCard, PrioritiesCard, QueryTableCard, StructureOverviewCard } from "../domain/view-models.js"
import { buildIndicatorAnalysis } from "./indicator-analysis.js"
import { buildWorkforce, WORKFORCE_STATUS_FILTERS, type StatusFreshness, type StatusLoader } from "./workforce.js"
import { buildIndicatorDiagnosis, type HireDatesLoader, type InteractionStatsLoader } from "./indicator-diagnosis.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { queryTableMarkdown, runIndicatorQuery, type PeriodMode, type QueryGrouping, type QuerySituation, type QuerySort, type QueryView } from "./indicator-query.js"
import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import { buildLeadershipPriorities, type PendingActionsLoader } from "./leadership-priorities.js"
import { periodCoveredFor, resolveAnalysisPeriod, resolveIndicatorReference, resolveStructureReference, type ReferenceOutcome } from "./references.js"
import { PRV_DEFINITION } from "./official-query.js"
import { buildStructureOverview } from "./structure-overview.js"
import { buildStructurePeople } from "./structure-people.js"

/**
 * FERRAMENTAS DA LIDERANÇA — o catálogo ÚNICO que o chat oferece a quem tem escopo de liderança (qualquer nível: o escopo
 * resolvido no backend é o que muda). Somente leitura. O modelo escolhe a ferramenta e descreve o pedido em linguagem natural;
 * quem resolve estrutura, indicador, competência e escopo é o backend. Cada execução devolve:
 *  - `text`: os fatos calculados, com base, método e limitações, para a INIA explicar (nunca para inventar);
 *  - `card`: o mesmo resultado estruturado, exibido na tela com os números do backend e os links de aprofundamento.
 */

export const LEADERSHIP_TOOL_NAMES = ["leadership_priorities", "leadership_structure_overview", "leadership_indicator_analysis", "leadership_people", "leadership_indicator_query", "leadership_workforce", "leadership_indicator_diagnosis"] as const
export type LeadershipToolName = (typeof LEADERSHIP_TOOL_NAMES)[number]

export function isLeadershipTool(name: string): name is LeadershipToolName {
  return (LEADERSHIP_TOOL_NAMES as readonly string[]).includes(name)
}

const structureParameter = { type: "string", description: 'Estrutura a analisar, como o usuário disse: omita (ou "minha") para a estrutura que ele lidera; ou o nome de um liderado (supervisor, coordenador, gerente), de um Grupo ou de um Subgrupo.' }
const periodParameter = { type: "string", description: "Competência oficial no formato AAAA-MM, só quando o usuário pedir um mês. Omita para usar a mais recente com dado." }
const indicatorParameter = { type: "string", description: "Nome ou código do indicador, como o usuário disse (ex.: TMA, FCR, Tempo Médio de Atendimento)." }

export const LEADERSHIP_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "leadership_priorities",
    description: "Onde o líder precisa atuar agora: decisões que aguardam ele (revisões, intervenções, produção não identificada, com prazos) e os maiores desvios da estrutura (indicadores e unidades com mais pessoas fora da referência, ciências pendentes). Use para 'onde preciso atuar', 'o que priorizar hoje', 'minhas pendências', 'próximos passos'.",
    parameters: { type: "object", properties: { estrutura: structureParameter, competencia: periodParameter } },
  },
  {
    name: "leadership_structure_overview",
    description: "Visão geral dos indicadores de uma estrutura: pessoas por situação (fora/dentro da referência, em evolução, sem dado), cada indicador com quantas pessoas estão fora da referência (quantidade e %), variação contra o mês anterior e as unidades abaixo (equipes, supervisores, coordenadores, gerentes) com mais pessoas fora. Use para 'como está minha equipe/estrutura', 'quais indicadores estão piores', 'resumo da equipe do X'.",
    parameters: { type: "object", properties: { estrutura: structureParameter, competencia: periodParameter } },
  },
  {
    name: "leadership_indicator_analysis",
    description: "Análise de UM indicador numa estrutura: quantidade e % de pessoas dentro e fora da meta (com a base de cálculo), melhores e piores resultados pela regra do indicador (com empates), quartis oficiais, decis, distribuição pelas unidades abaixo, participação de cada unidade no total de pessoas fora, padrão concentrado × disseminado e o que é ou não comparável. Use para 'qual % do meu time está ruim em X', 'piores e melhores em X', 'quartis/decis de X', 'onde está concentrado', 'compare as equipes em X'.",
    parameters: {
      type: "object",
      properties: {
        indicador: indicatorParameter,
        estrutura: structureParameter,
        competencia: periodParameter,
        agrupar_por: { type: "string", description: "Só quando o usuário pedir um recorte específico. Omita para o nível de gestão logo abaixo.", enum: ["SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "TEAM", "SUBTEAM"] },
      },
      required: ["indicador"],
    },
  },
  {
    name: "leadership_people",
    description: "Quem são as pessoas da estrutura: fora da referência num indicador, numa situação (fora da referência, sem dado, em evolução, dentro da referência) ou com ciência/revisão pendente. Use para 'quem está fora da meta em X', 'quais pessoas estão sem dado', 'quem tem feedback sem ciência'.",
    parameters: {
      type: "object",
      properties: {
        estrutura: structureParameter,
        competencia: periodParameter,
        indicador: indicatorParameter,
        situacao: { type: "string", description: "Situação das pessoas, quando não for por indicador.", enum: ["BELOW_REFERENCE", "NO_DATA", "IMPROVING", "WITHIN_REFERENCE"] },
        so_pendentes: { type: "boolean", description: "true = só quem tem feedback aguardando ciência ou revisão pendente." },
      },
    },
  },
]

LEADERSHIP_TOOL_DECLARATIONS.push({
  name: "leadership_indicator_query",
  description:
    "CONSULTA FLEXÍVEL aos resultados da estrutura, calculada pelo sistema — use para QUALQUER pergunta de números: piores/melhores (pessoas ou unidades), PRV e quartil geral, quartis e dispersão, % ou quantidade fora/dentro da meta, comparações entre supervisores/coordenadores/gerentes/Grupos/Subgrupos, evolução e recorrência nos últimos N meses, consolidado de todos os indicadores, mês em curso (medição diária). Monte o pedido: indicadores (ou PRV), visão, recorte, competências e como lê-las, filtros, ordenação e limite. A resposta traz quantidades, percentuais e nomes.",
  parameters: {
    type: "object",
    properties: {
      indicadores: { type: "array", items: { type: "string" }, description: "Nomes ou códigos dos indicadores; \"PRV\" = resultado geral da pessoa (quartil geral). Vazio = todos com dado." },
      visao: { type: "string", description: "INDICADOR (padrão: resultado de cada indicador) · CONSOLIDADO (todos os indicadores juntos + PRV: quem tem algum indicador fora, atingimento geral, PRV médio, Q4 de PRV) · QUARTIS (distribuição Q1–Q4 oficial e dispersão; sem indicador = quartil geral/PRV).", enum: ["INDICADOR", "CONSOLIDADO", "QUARTIS"] },
      estrutura: structureParameter,
      agrupar_por: { type: "string", description: "Linhas da tabela. UNIDADE = nível de gestão logo abaixo (padrão para comparar equipes). PESSOA = nomes. COMPETENCIA = evolução mês a mês da estrutura.", enum: ["ESTRUTURA", "UNIDADE", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "TEAM", "SUBTEAM", "PESSOA", "COMPETENCIA"] },
      competencia: periodParameter,
      ultimas_competencias: { type: "integer", description: "Quantas competências oficiais até a de referência (1 a 6) — \"nos últimos N meses\"." },
      periodos_como: { type: "string", description: "Com várias competências: ULTIMA (padrão: a última + variação desde a primeira) · MEDIA (média do período) · POR_MES (uma coluna por mês) · RECORRENCIA (quantas vezes ficou fora/no Q4; para recortes, em quantos meses ficou acima da estrutura — \"quem está pior há mais tempo\").", enum: ["ULTIMA", "MEDIA", "POR_MES", "RECORRENCIA"] },
      fonte: { type: "string", description: "OFICIAL (padrão, fechamento mensal) ou OPERACIONAL (medição diária do período em curso: \"neste mês\", \"esta semana\").", enum: ["OFICIAL", "OPERACIONAL"] },
      janela: { type: "string", description: "Só com fonte OPERACIONAL.", enum: ["MES_CORRENTE", "SEMANA_CORRENTE", "ULTIMOS_7_DIAS", "BIMESTRE", "TRIMESTRE"] },
      situacao: { type: "string", description: "Filtro de pessoas (agrupar_por=PESSOA).", enum: ["FORA", "DENTRO", "SEM_DADO"] },
      quartis: { type: "array", items: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"] }, description: "Filtro de pessoas pelo quartil oficial (do indicador ou do PRV)." },
      minimo_indicadores_fora: { type: "integer", description: "Pessoas fora em pelo menos N indicadores." },
      ordenar_por: { type: "string", enum: ["PCT_FORA", "FORA", "ATINGIMENTO", "VARIACAO", "Q4", "DISPERSAO", "NOME"] },
      ordem: { type: "string", enum: ["ASC", "DESC"] },
      limite: { type: "integer", description: "Máximo de linhas (até 50)." },
    },
  },
})

LEADERSHIP_TOOL_DECLARATIONS.push({
  name: "leadership_workforce",
  description:
    "Números de PESSOAS da estrutura por situação funcional numa data: quantas e quantos % estão em produção, de férias, afastadas, em atividade off etc., por unidade, Grupo ou Subgrupo — e quem são, quando pedido. Use para \"quantas pessoas estão de férias\", \"% em produção\", \"quem está afastado na equipe do X\", \"quantas pessoas tem minha estrutura\". Afastamentos sensíveis nunca saem por nome.",
  parameters: {
    type: "object",
    properties: {
      estrutura: structureParameter,
      agrupar_por: { type: "string", enum: ["ESTRUTURA", "UNIDADE", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "TEAM", "SUBTEAM"] },
      situacoes: { type: "array", items: { type: "string", enum: Object.keys(WORKFORCE_STATUS_FILTERS) }, description: "Filtrar situações (ex.: FERIAS). Vazio = todas." },
      data: { type: "string", description: "Data AAAA-MM-DD (padrão: hoje). Datas futuras usam os períodos já informados (ex.: férias programadas)." },
      listar_pessoas: { type: "boolean", description: "true = lista nominal (quem são)." },
      incluir_lideres: { type: "boolean", description: "true = conta também supervisores/coordenadores abaixo; padrão: só operadores." },
      limite: { type: "integer" },
    },
  },
})

LEADERSHIP_TOOL_DECLARATIONS.push({
  name: "leadership_indicator_diagnosis",
  description:
    "DIAGNÓSTICO de um indicador: \"onde está o principal problema em X?\", \"o que os piores em X têm em comum?\", \"por que X está ruim?\". Compara quem está fora da meta (ou no Q4) com quem está dentro (ou no Q1) nas interações registradas — motivo e submotivo das chamadas, volume por pessoa, duração por motivo (indicadores de tempo: quanto cada motivo explica da diferença) —, tempo de casa e as unidades onde os piores estão. Traz associações, não causas.",
  parameters: {
    type: "object",
    properties: {
      indicador: indicatorParameter,
      estrutura: structureParameter,
      competencia: periodParameter,
      meses_de_interacoes: { type: "integer", description: "Quantos meses de interações até a competência (1 a 3; padrão 3 — mais amostra)." },
      comparar: { type: "string", description: "FORA_X_DENTRO (padrão) ou Q4_X_Q1 (quartis oficiais).", enum: ["FORA_X_DENTRO", "Q4_X_Q1"] },
      nivel: { type: "string", description: "SUBMOTIVO (padrão: motivo › submotivo) ou MOTIVO (só o motivo genérico, mais amostra por linha).", enum: ["SUBMOTIVO", "MOTIVO"] },
    },
    required: ["indicador"],
  },
})

/** Voz: UMA ferramenta que leva a pergunta ao mesmo raciocínio do chat de texto (dados da estrutura + especialistas), no backend. */
export const LEADERSHIP_ASK_TOOL = "leadership_ask"
export const LEADERSHIP_ASK_DECLARATION: FunctionDeclaration = {
  name: LEADERSHIP_ASK_TOOL,
  description:
    "Responde com dados reais qualquer pergunta de quem lidera: equipe/estrutura, indicadores, metas, pessoas, comparações, evolução, pendências, prioridades, como melhorar um indicador e processos para orientar a equipe. Passe a pergunta completa, já com o contexto da conversa (qual indicador, equipe ou mês foi falado antes).",
  parameters: { type: "object", properties: { query: { type: "string", description: "A pergunta do usuário, completa e com o contexto da conversa." } }, required: ["query"] },
}

export type LeadershipToolDependencies = {
  repository: AnalyticsReadRepository
  scope: ViewerScope
  closure: { lastClosedPeriod: string; now: Date; timeZone: string }
  loadPendingActions: PendingActionsLoader
  /** Situação funcional vigente numa data (força de trabalho). Ausente = ferramenta indisponível. */
  loadStatuses?: StatusLoader
  statusFreshness?: () => Promise<StatusFreshness | null>
  /** Interações agregadas (diagnóstico) e datas de admissão. Ausentes = diagnóstico indisponível. */
  loadInteractionStats?: InteractionStatsLoader
  loadHireDates?: HireDatesLoader
}

/** `issue` = pedido não resolvido (ambíguo, fora do escopo/inexistente, inválido): o chat repassa ao modelo, a rota vira 422. */
export type LeadershipToolIssue = { kind: "AMBIGUOUS" | "NOT_FOUND" | "INVALID"; message: string; candidates: string[] }
export type LeadershipToolResult = { text: string; card: LeadershipCard | null; issue?: LeadershipToolIssue; trace?: Record<string, unknown> }

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)
const SITUATIONS: MemberSituation[] = ["BELOW_REFERENCE", "NO_DATA", "IMPROVING", "WITHIN_REFERENCE"]

function clarification<T>(outcome: ReferenceOutcome<T>, what: string): LeadershipToolResult | null {
  if (outcome.kind === "AMBIGUOUS") return { text: `Ambiguidade (${what}): há mais de uma opção — ${outcome.candidates.join("; ")}. Pergunte ao usuário qual delas, sem escolher por conta própria.`, card: null, issue: { kind: "AMBIGUOUS", message: `Há mais de uma opção de ${what}: ${outcome.candidates.join("; ")}.`, candidates: outcome.candidates } }
  if (outcome.kind === "NOT_FOUND") return { text: `${outcome.message} Diga isso ao usuário e ofereça as opções do escopo dele; não invente dados.`, card: null, issue: { kind: "NOT_FOUND", message: outcome.message, candidates: [] } }
  return null
}

export async function executeLeadershipTool(deps: LeadershipToolDependencies, name: string, args: Record<string, unknown>): Promise<LeadershipToolResult> {
  const { repository, scope, closure } = deps
  try {
    // `subject_kind/subject_id` não são declarados ao modelo: vêm de quem chama pelo backend (rota da tela) e são validados
    // contra o escopo como qualquer referência.
    const structureOutcome = resolveStructureReference(scope, { name: str(args.estrutura), subjectKind: str(args.subject_kind), subjectId: str(args.subject_id) })
    if (name === "leadership_priorities") {
      // Sem estrutura própria (ex.: só acesso ampliado), as decisões pendentes continuam valendo.
      const structure = structureOutcome.kind === "OK" ? structureOutcome.value : null
      if (!structure && (str(args.estrutura) || str(args.subject_id))) return clarification(structureOutcome, "estrutura")!
      const period = structure ? await resolveAnalysisPeriod(repository, scope, structure.resolved.members.map((member) => member.id), str(args.competencia), closure) : null
      const card = withPeriodNote(await buildLeadershipPriorities(repository, scope, { structure, period: period?.period ?? null, loadPendingActions: deps.loadPendingActions, now: closure.now }), period?.note ?? null)
      return { text: renderPriorities(card), card }
    }
    const blocked = clarification(structureOutcome, "estrutura")
    if (blocked || structureOutcome.kind !== "OK") return blocked!
    const structure = structureOutcome.value
    const resolvedPeriod = await resolveAnalysisPeriod(repository, scope, structure.resolved.members.map((member) => member.id), str(args.competencia), closure)
    const period = resolvedPeriod.period

    if (name === "leadership_structure_overview") {
      const card = withPeriodNote(await buildStructureOverview(repository, scope, { structure, period, now: closure.now }), resolvedPeriod.note)
      return { text: renderOverview(card), card }
    }
    const definitions = await repository.loadIndicatorDefinitions(scope.organizationId)
    if (name === "leadership_indicator_analysis") {
      const indicatorOutcome = resolveIndicatorReference(definitions, str(args.indicador))
      const indicatorBlocked = clarification(indicatorOutcome, "indicador")
      if (indicatorBlocked || indicatorOutcome.kind !== "OK") return indicatorBlocked!
      const groupBy = isGroupingDimension(args.agrupar_por) ? args.agrupar_por : null
      const card = withPeriodNote(await buildIndicatorAnalysis(repository, scope, { structure, indicator: indicatorOutcome.value, period, groupBy, now: closure.now }), resolvedPeriod.note)
      return { text: renderIndicatorAnalysis(card), card }
    }
    if (name === "leadership_people") {
      const indicatorText = str(args.indicador)
      const indicatorOutcome = indicatorText ? resolveIndicatorReference(definitions, indicatorText) : null
      if (indicatorOutcome) {
        const indicatorBlocked = clarification(indicatorOutcome, "indicador")
        if (indicatorBlocked) return indicatorBlocked
      }
      const situation = SITUATIONS.find((value) => value === args.situacao) ?? null
      const card = await buildStructurePeople(repository, scope, { structure, period, situation, indicator: indicatorOutcome?.kind === "OK" ? indicatorOutcome.value : null, pendingOnly: args.so_pendentes === true, now: closure.now })
      return { text: renderPeople(card), card }
    }
    if (name === "leadership_workforce") {
      if (!deps.loadStatuses) return { text: "A situação funcional não está disponível aqui.", card: null, issue: { kind: "INVALID", message: "Situação funcional indisponível.", candidates: [] } }
      const today = localDateOf(closure.now, closure.timeZone)
      const date = typeof args.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.data) ? args.data : today
      const statuses = Array.isArray(args.situacoes) ? args.situacoes.flatMap((value) => WORKFORCE_STATUS_FILTERS[String(value)] ?? []) : null
      const card = await buildWorkforce(scope, {
        structure,
        groupBy: QUERY_GROUPINGS[String(args.agrupar_por ?? "")] ?? "STRUCTURE",
        date,
        dateLabel: date === today ? `hoje (${date.split("-").reverse().join("/")})` : date.split("-").reverse().join("/"),
        statuses,
        listPeople: args.listar_pessoas === true,
        includeLeaders: args.incluir_lideres === true,
        loadStatuses: deps.loadStatuses,
        freshness: deps.statusFreshness ? await deps.statusFreshness() : null,
        limit: typeof args.limite === "number" ? args.limite : 30,
        now: closure.now,
      })
      return { text: renderQueryTable(card), card }
    }
    if (name === "leadership_indicator_diagnosis") {
      if (!deps.loadInteractionStats) return { text: "As interações não estão disponíveis aqui.", card: null, issue: { kind: "INVALID", message: "Interações indisponíveis.", candidates: [] } }
      const indicatorOutcome = resolveIndicatorReference(definitions, str(args.indicador))
      const indicatorBlocked = clarification(indicatorOutcome, "indicador")
      if (indicatorBlocked || indicatorOutcome.kind !== "OK") return indicatorBlocked!
      const diagnosisPeriod = await periodCoveredFor(repository, scope, structure.resolved.members.map((member) => member.id), [indicatorOutcome.value.code], resolvedPeriod)
      const card = withPeriodNote(
        await buildIndicatorDiagnosis(repository, scope, {
          structure,
          indicator: indicatorOutcome.value,
          period: diagnosisPeriod.period,
          months: Math.min(3, Math.max(1, typeof args.meses_de_interacoes === "number" ? Math.round(args.meses_de_interacoes) : 3)),
          compare: args.comparar === "Q4_X_Q1" ? "Q4_VS_Q1" : "BELOW_VS_WITHIN",
          level: args.nivel === "MOTIVO" ? "REASON" : "SUB_REASON",
          loadInteractions: deps.loadInteractionStats,
          loadHireDates: deps.loadHireDates ?? null,
          now: closure.now,
        }),
        diagnosisPeriod.note,
      )
      return { text: renderQueryTable(card), card }
    }
    if (name === "leadership_indicator_query") {
      const requested = Array.isArray(args.indicadores) ? args.indicadores.map(str).filter((value): value is string => value !== null) : []
      const indicators: IndicatorDefinitionRow[] = []
      for (const text of requested) {
        const outcome = resolveIndicatorReference(definitions, text)
        const indicatorBlocked = clarification(outcome, "indicador")
        if (indicatorBlocked || outcome.kind !== "OK") return indicatorBlocked!
        if (!indicators.some((definition) => definition.code === outcome.value.code)) indicators.push(outcome.value)
      }
      const count = Math.min(6, Math.max(1, typeof args.ultimas_competencias === "number" ? Math.round(args.ultimas_competencias) : 1))
      // Pedido de indicadores específicos (ou do PRV): a competência padrão é a completa PARA ELES.
      const queryPeriod = args.fonte === "OPERACIONAL" ? resolvedPeriod : await periodCoveredFor(repository, scope, structure.resolved.members.map((member) => member.id), (indicators.length > 0 ? indicators : args.visao === "QUARTIS" ? [PRV_DEFINITION] : []).map((definition) => definition.code), resolvedPeriod)
      const groupBy = QUERY_GROUPINGS[String(args.agrupar_por ?? "")] ?? (indicators.length === 1 || args.visao === "QUARTIS" ? "UNIT" : "STRUCTURE")
      // "Consolidado" só do PRV é o próprio resultado geral: a visão por indicador já é a resposta (ranking, quartil, situação).
      const requestedView = QUERY_VIEWS[String(args.visao ?? "")] ?? "INDICATOR"
      const view = requestedView === "CONSOLIDATED" && indicators.length === 1 && indicators[0]!.code === PRV_DEFINITION.code ? "INDICATOR" : requestedView
      const card = withPeriodNote(
        await runIndicatorQuery(repository, scope, {
          structure,
          indicators,
          periods: referencePeriodWindow(queryPeriod.period, count),
          groupBy,
          view,
          periodMode: QUERY_PERIOD_MODES[String(args.periodos_como ?? "")] ?? "LATEST",
          source: args.fonte === "OPERACIONAL" ? "OPERATIONAL" : "OFFICIAL",
          window: QUERY_WINDOWS[String(args.janela ?? "")] ?? "MONTH",
          situation: QUERY_SITUATIONS[String(args.situacao ?? "")] ?? null,
          quartiles: Array.isArray(args.quartis) ? args.quartis.filter((value): value is Quartile => QUARTILE_VALUES.includes(value as Quartile)) : null,
          minBelowIndicators: typeof args.minimo_indicadores_fora === "number" ? Math.max(1, Math.round(args.minimo_indicadores_fora)) : null,
          sort: QUERY_SORTS[String(args.ordenar_por ?? "")] ?? null,
          order: args.ordem === "ASC" ? "asc" : args.ordem === "DESC" ? "desc" : null,
          limit: typeof args.limite === "number" ? args.limite : 20,
          now: closure.now,
        }),
        args.fonte === "OPERACIONAL" ? null : queryPeriod.note,
      )
      return { text: renderQueryTable(card), card }
    }
    return { text: "Ferramenta desconhecida.", card: null, issue: { kind: "INVALID", message: "Ferramenta desconhecida.", candidates: [] } }
  } catch (error) {
    if (error instanceof DomainError && error.statusCode < 500) return { text: `${error.message} Explique ao usuário.`, card: null, issue: { kind: "INVALID", message: error.message, candidates: [] } }
    throw error
  }
}

/**
 * Resumo de UMA linha de um cartão — o texto exibido (e gravado) quando a ferramenta é acionada pela VOZ: o detalhe fica no cartão
 * ao lado e a INIA fala um resumo. Determinístico: os números são os do cartão.
 */
export function summarizeLeadershipCard(card: LeadershipCard): string {
  const where = (structure: { label: string } | null, periodLabel: string | null) => [structure?.label, periodLabel].filter(Boolean).join(" · ")
  switch (card.type) {
    case "INDICATOR_ANALYSIS":
      return `${card.indicator.name} — ${where(card.structure, card.periodLabel)}: ${card.reference.below} de ${card.population.withReference} pessoas com referência fora (${num(card.reference.belowPercent, "%")}).${card.concentration && card.concentration.pattern !== "UNDETERMINED" ? ` ${card.concentration.explanation}` : ""}`
    case "STRUCTURE_OVERVIEW":
      return `Visão geral — ${where(card.structure, card.periodLabel)}: ${card.members.belowReference} de ${card.members.withData} pessoas com dado têm algum indicador fora da referência${card.indicators[0] ? `; mais pessoas fora em ${card.indicators[0].name} (${card.indicators[0].below} de ${card.indicators[0].withReference})` : ""}.`
    case "PEOPLE":
      return `${card.filter.label} — ${where(card.structure, card.periodLabel)}: ${card.total} ${card.total === 1 ? "pessoa" : "pessoas"}.`
    case "PRIORITIES":
      return card.items.length === 0 ? "Onde atuar: nenhuma decisão pendente e nenhum desvio em destaque." : `Onde atuar${card.structure ? ` — ${where(card.structure, card.periodLabel)}` : ""}: ${card.items.slice(0, 3).map((item) => item.title).join("; ")}.`
    case "QUERY_TABLE":
      return `${card.title} — ${card.structure.label} · ${card.scopeNote}: ${card.totalRows} ${card.totalRows === 1 ? "linha" : "linhas"}.`
  }
}

function renderQueryTable(card: QueryTableCard): string {
  const lines = [HEADER, `Estrutura: ${card.structure.label}${card.structure.description ? ` (${card.structure.description})` : ""} · ${card.scopeNote}${card.period ? ` (competencia=${card.period})` : ""}`, `Consulta: ${card.title}${card.totalRows > card.rows.length ? ` — ${card.rows.length} de ${card.totalRows} linhas (ordenadas)` : ""}`]
  if (card.highlights.length > 0) lines.push(`Destaques: ${card.highlights.join(" ")}`)
  lines.push("", queryTableMarkdown(card), "")
  if (card.limitations.length > 0) lines.push(`Limitações: ${card.limitations.join(" ")}`)
  lines.push(`Base de cálculo: ${card.methods.slice(0, 3).join(" ")}`)
  return lines.join("\n")
}

const QUERY_GROUPINGS: Record<string, QueryGrouping> = { ESTRUTURA: "STRUCTURE", UNIDADE: "UNIT", SUPERVISOR: "SUPERVISOR", COORDINATOR: "COORDINATOR", MANAGER: "MANAGER", SENIOR_MANAGER: "SENIOR_MANAGER", TEAM: "TEAM", SUBTEAM: "SUBTEAM", PESSOA: "PERSON", COMPETENCIA: "PERIOD" }
const QUERY_WINDOWS: Record<string, OperationalComparison> = { MES_CORRENTE: "MONTH", SEMANA_CORRENTE: "WEEK", ULTIMOS_7_DIAS: "ROLLING_7_DAYS", BIMESTRE: "TWO_MONTHS", TRIMESTRE: "QUARTER" }
const QUERY_SITUATIONS: Record<string, QuerySituation> = { FORA: "BELOW", DENTRO: "WITHIN", SEM_DADO: "NO_DATA" }
const QUERY_SORTS: Record<string, QuerySort> = { PCT_FORA: "BELOW_PERCENT", FORA: "BELOW", ATINGIMENTO: "ACHIEVEMENT", VARIACAO: "CHANGE", NOME: "NAME", Q4: "Q4", DISPERSAO: "DISPERSION" }
const QUERY_VIEWS: Record<string, QueryView> = { INDICADOR: "INDICATOR", CONSOLIDADO: "CONSOLIDATED", QUARTIS: "QUARTILES" }
const QUERY_PERIOD_MODES: Record<string, PeriodMode> = { ULTIMA: "LATEST", MEDIA: "AVERAGE", POR_MES: "BY_MONTH", RECORRENCIA: "RECURRENCE" }
const QUARTILE_VALUES: Quartile[] = ["Q1", "Q2", "Q3", "Q4"]

/** A escolha da competência padrão (ex.: fechamento parcial mais novo deixado de lado) vira a primeira limitação do cartão. */
function withPeriodNote<T extends { limitations: string[] }>(card: T, note: string | null): T {
  return note ? { ...card, limitations: [note, ...card.limitations] } : card
}

// ---------------------------------------------------------------------------------------------
// Texto factual para o modelo — compacto, com base e limitações; o cartão leva o resto.
// ---------------------------------------------------------------------------------------------

const HEADER = "[Dados calculados pela INIA no escopo do usuário — use exatamente estes números e tabelas; a resposta deve ser completa em markdown]"
const num = (value: number | null, suffix = "") => (value === null ? "sem dado" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`)
const structureLine = (card: { structure: { label: string; description: string | null }; period?: string | null; periodLabel: string | null }) => `Estrutura: ${card.structure.label}${card.structure.description ? ` (${card.structure.description})` : ""}${card.periodLabel ? ` · Competência oficial: ${card.periodLabel}${card.period ? ` (competencia=${card.period})` : ""}` : ""}`
const DIRECTION_TEXT = { HIGHER: "maior é melhor", LOWER: "menor é melhor", TARGET: "na meta é melhor" } as const

/** Tabela markdown simples (números já formatados). */
function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return ""
  const clean = (value: string) => value.replace(/\|/g, "/")
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(clean).join(" | ")} |`)].join("\n")
}

function renderIndicatorAnalysis(card: IndicatorAnalysisCard): string {
  const { indicator, population, reference, previous } = card
  const value = (amount: number | null) => (amount === null ? "—" : formatIndicatorValue(amount, indicator.unit))
  const lines = [
    HEADER,
    structureLine(card),
    `Indicador: ${indicator.name} — ${DIRECTION_TEXT[indicator.direction]}`,
    `Resumo: **${reference.below} de ${population.withReference}** pessoas com referência estão fora (**${num(reference.belowPercent, "%")}**); dentro: ${reference.within} (${num(reference.withinPercent, "%")}). ${population.noData} sem dado (fora do denominador) de ${population.memberCount} operadores ativos.${previous.belowPercent !== null ? ` Em ${previous.periodLabel}: ${num(previous.belowPercent, "%")} fora (${previous.deltaPp !== null && previous.deltaPp > 0 ? "+" : ""}${num(previous.deltaPp, " p.p.")}).` : ""}`,
    `Atingimento médio (média simples dos atingimentos individuais, leitura de apoio): ${num(card.averageAchievementPercent, "%")}.`,
  ]
  if (card.units.length > 0) {
    lines.push("", `Por ${card.unitsGroupByLabel?.toLowerCase() ?? "unidade"} (mais pessoas fora primeiro):`, table(
      ["Unidade", "Fora / com referência", "% fora", "% do total de fora", "Atingimento médio", "Comparável"],
      card.units.slice(0, 12).map((unit) => [`${unit.label}${unit.description ? ` (${unit.description})` : ""}`, `${unit.below} / ${unit.withReference}`, num(unit.belowPercent, "%"), num(unit.shareOfDeviationsPercent, "%"), num(unit.averageAchievementPercent, "%"), unit.comparable ? "sim" : `não — ${unit.comparabilityReasons.join("; ")}`]),
    ))
  }
  if (card.concentration) lines.push(`Padrão: ${card.concentration.explanation}`)
  if (card.comparison.note) lines.push(`Comparação: ${card.comparison.note}`)
  if (card.ranking.reason === "OK") {
    const ranked = (entries: IndicatorAnalysisCard["ranking"]["best"]) => entries.map((entry) => [`${entry.position}º`, entry.name, entry.unitLabel ?? "—", num(entry.achievementPercent, "%"), `${value(entry.value)}${entry.targetValue !== null ? ` (meta ${value(entry.targetValue)})` : ""}`, entry.decile ?? "—", entry.officialQuartile ?? "—"])
    const headers = ["Posição", "Pessoa", "Unidade", "Atingimento", "Valor", "Decil", "Quartil oficial"]
    if (card.ranking.worst.length > 0) lines.push("", `Menores atingimentos (de ${card.ranking.rankedCount} ranqueados):`, table(headers, ranked(card.ranking.worst)))
    lines.push("", "Maiores atingimentos:", table(headers, ranked(card.ranking.best)))
  }
  lines.push("", `Quartis oficiais: Q1 ${card.officialQuartiles.Q1}, Q2 ${card.officialQuartiles.Q2}, Q3 ${card.officialQuartiles.Q3}, Q4 ${card.officialQuartiles.Q4}, sem quartil ${card.officialQuartiles.NO_DATA}.`)
  if (card.deciles.reason === "OK") lines.push(`Decis na estrutura: ${Object.entries(card.deciles.counts).map(([decile, count]) => `${decile} ${count}`).join(", ")}.`)
  if (card.limitations.length > 0) lines.push(`Limitações: ${card.limitations.join(" ")}`)
  lines.push(`Base de cálculo: ${card.methods.slice(0, 3).join(" ")}`)
  return lines.join("\n")
}

function renderOverview(card: StructureOverviewCard): string {
  const lines = [
    HEADER,
    structureLine(card),
    `Resumo: ${card.members.total} operadores ativos; ${card.members.withData} com dado oficial; **${card.members.belowReference}** com algum indicador fora da referência; ${card.members.withinReference} dentro; ${card.members.improving} em evolução; ${card.members.noData} sem dado.`,
    "",
    "Indicadores (mais pessoas fora primeiro):",
    table(["Indicador", "Fora / com referência", "% fora", "Mês anterior", "Variação", "Atingimento médio"], card.indicators.slice(0, 12).map((indicator) => [indicator.name, `${indicator.below} / ${indicator.withReference}`, num(indicator.belowPercent, "%"), num(indicator.previousBelowPercent, "%"), indicator.deltaPp === null ? "—" : `${indicator.deltaPp > 0 ? "+" : ""}${num(indicator.deltaPp, " p.p.")}`, num(indicator.averageAchievementPercent, "%")])),
  ]
  if (card.units.length > 0) lines.push("", `Unidades (${card.unitsGroupByLabel ?? "abaixo"}), maior proporção de pessoas com indicador fora primeiro:`, table(["Unidade", "Com indicador fora / com dado", "%", "Indicadores mais críticos"], card.units.slice(0, 12).map((unit) => [unit.label, `${unit.belowReferenceCount} / ${unit.membersWithData}`, num(unit.belowReferencePercent, "%"), unit.topAttentionIndicators.map((entry) => entry.name).join(", ") || "—"])))
  if (card.awaitingAcknowledgement > 0) lines.push(`Feedbacks aguardando ciência na estrutura: ${card.awaitingAcknowledgement}.`)
  if (card.operational) {
    const withCurrent = card.operational.indicators.filter((indicator) => indicator.current !== "—")
    lines.push("", `Mês corrente pela medição diária (${card.operational.windowLabel} × ${card.operational.previousWindowLabel}; parcial, sem meta oficial):`)
    lines.push(withCurrent.length === 0 ? "Ainda não há medição diária no mês corrente para esta estrutura — para o mês em curso não há dado; o último fechamento oficial é o da tabela acima." : table(["Indicador", "Mês corrente", "Mês anterior", "Desempenho", "Pessoas com dado"], card.operational.indicators.map((indicator) => [indicator.name, indicator.current, indicator.previous, indicator.trend ?? "—", indicator.coverage])))
  }
  if (card.limitations.length > 0) lines.push(`Limitações: ${card.limitations.join(" ")}`)
  lines.push(`Base de cálculo: ${card.methods[0]}`)
  return lines.join("\n")
}

function renderPeople(card: PeopleCard): string {
  const lines = [HEADER, structureLine(card), `${card.filter.label}: **${card.total}** ${card.total === 1 ? "pessoa" : "pessoas"}${card.total > card.members.length ? ` (mostrando ${card.members.length}; a lista completa está na aba Equipe/Indicadores)` : ""}.`]
  if (card.members.length > 0) {
    lines.push("", card.members[0]!.indicator
      ? table(["Pessoa", "Atingimento", "Valor", "Meta"], card.members.map((member) => [member.name, num(member.indicator!.achievementPercent, "%"), member.indicator!.value === null ? "—" : String(member.indicator!.value), member.indicator!.targetValue === null ? "—" : String(member.indicator!.targetValue)]))
      : table(["Pessoa", "Situação", "Indicadores fora", "Sem ciência", "Revisões"], card.members.map((member) => [member.name, member.situation, member.attentionIndicators.map((entry) => `${entry.name} (${num(entry.achievementPercent, "%")})`).join("; ") || "—", String(member.awaitingAcknowledgement), String(member.pendingReviews)])))
  }
  return lines.join("\n")
}

function renderPriorities(card: PrioritiesCard): string {
  const lines = [HEADER, card.structure ? structureLine({ structure: card.structure, period: card.period, periodLabel: card.periodLabel }) : "Sem estrutura própria: só as decisões endereçadas ao usuário."]
  if (card.items.length === 0) lines.push("Nenhuma decisão pendente e nenhum desvio destacado na competência.")
  for (const [index, item] of card.items.entries()) lines.push(`${index + 1}. [${item.severity === "HIGH" ? "alta" : item.severity === "MEDIUM" ? "média" : "baixa"}] ${item.title} — ${item.evidence}`)
  if (card.limitations.length > 0) lines.push(`Limitações: ${card.limitations.join(" ")}`)
  lines.push(`Ordem aplicada: ${card.method}`)
  return lines.join("\n")
}
