import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { FunctionDeclaration } from "../../assistant/infrastructure/gemini-function-calling-client.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { resolveOfficialClosure } from "../../indicators/application/official-closure.js"
import { buildPendingActions } from "../../pending-actions/application/build-pending-actions.js"
import { PgPendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { PgAnalyticsReadRepository, type AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { collectUnits } from "../../performance-analytics/application/build-team-overview.js"
import { hasAccessGrant, loadViewerScope, resolveSubject, type ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { analyticsSubjectSchema, isStructureSubject } from "../../performance-analytics/domain/analytics-subject.js"
import { GROUPING_LABELS } from "../../performance-analytics/domain/hierarchy-levels.js"
import { currentReferencePeriod, longPeriodLabel } from "../../performance-analytics/domain/reference-period.js"
import type { LeadershipCard, PrioritiesCard } from "../domain/view-models.js"
import { buildLeadershipPriorities, type PendingActionsLoader } from "./leadership-priorities.js"
import type { StatusFreshness, StatusLoader } from "./workforce.js"
import type { HireDatesLoader, InteractionStatsLoader } from "./indicator-diagnosis.js"
import { coveringStatusPeriodSql } from "../../people/application/employment-status-service.js"
import { resolveEmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { executeLeadershipTool, isLeadershipTool, LEADERSHIP_ASK_TOOL, LEADERSHIP_TOOL_DECLARATIONS, type LeadershipToolDependencies, type LeadershipToolResult } from "./leadership-toolset.js"
import { processScopeOf, structureGroupsOf, type ProcessScope } from "./process-consultation.js"
import { resolveAnalysisPeriod, resolveStructureReference, type ResolvedStructure } from "./references.js"

/** Ferramentas executadas pelo próprio backend dentro de um turno do Orquestrador (ver run-orchestrated-reply.ts). */
export type DirectToolset = {
  declarations: FunctionDeclaration[]
  handles: (name: string) => boolean
  execute: (name: string, args: Record<string, unknown>) => Promise<LeadershipToolResult>
}

export type LeadershipChatContext = {
  /** Bloco de contexto do prompt — DADO do sistema (escopo, níveis abaixo, competência), mais as regras de resposta. */
  instructions: string
  /** Sessão de voz: o escopo e a regra de levar toda pergunta de gestão a `leadership_ask` (a resposta é montada no backend). */
  voiceInstructions: string
  toolset: DirectToolset
  /** Grupos da estrutura, para a consulta de processo pelo Orquestrador de cada Grupo (montada no chat, ver `process-consultation.ts`). */
  processScope?: ProcessScope
}

/** Voz de quem lidera: o modelo de voz só encaminha; quem consulta os dados e escreve a resposta é a orquestração do chat. */
export const LEADERSHIP_VOICE_RULES = [
  "Como conduzir a voz com quem lidera pessoas (essa pessoa NÃO realiza atendimentos):",
  `- Para QUALQUER pergunta sobre a equipe/estrutura, indicadores, metas, pessoas, comparações, evolução, pendências, prioridades, como melhorar um indicador ou processos para orientar a equipe, acione ${LEADERSHIP_ASK_TOOL} com a pergunta completa e o contexto da conversa (indicador, equipe e mês já falados).`,
  "- Acione a ferramenta IMEDIATAMENTE, na mesma resposta, SEM falar nada antes (nem \"vou consultar\"): uma frase sem a chamada encerra o turno e a pessoa fica sem resposta. Nunca fale números, nomes ou metas que não vieram da ferramenta.",
  "- Quando a resposta chegar, ela já está completa na tela: fale um resumo curto e fiel e diga que o detalhe está na tela.",
  `- Se a resposta anterior ofereceu criar um report recorrente e a pessoa aceitar ou recusar ("sim", "pode criar", "não precisa"), acione ${LEADERSHIP_ASK_TOOL} com a resposta dela, sem falar antes — quem abre a configuração é o sistema.`,
].join("\n")

export type LeadershipSession = {
  repository: AnalyticsReadRepository
  scope: ViewerScope
  closure: { lastClosedPeriod: string; now: Date; timeZone: string }
  /** A estrutura que a pessoa lidera (null = só acesso ampliado, sem estrutura própria). */
  own: ResolvedStructure | null
  loadPendingActions: PendingActionsLoader
  loadStatuses?: StatusLoader
  statusFreshness?: () => Promise<StatusFreshness | null>
  loadInteractionStats?: InteractionStatsLoader
  loadHireDates?: HireDatesLoader
}

/**
 * Quem tem escopo de liderança: lidera uma estrutura (sujeito padrão é uma estrutura) OU tem `indicators.view` em algum
 * escopo. Operador e conta sem pessoa = null (o chat segue sem as ferramentas — nada muda para o operador).
 */
export async function loadLeadershipSession(db: Database, user: AuthTokenPayload, options: { repository?: AnalyticsReadRepository; now?: Date; loadPendingActions?: PendingActionsLoader } = {}): Promise<LeadershipSession | null> {
  const repository = options.repository ?? new PgAnalyticsReadRepository(db)
  let scope: ViewerScope
  try {
    scope = await loadViewerScope(repository, user, "indicators.view")
  } catch (error) {
    if (error instanceof DomainError && error.code === "PERSON_NOT_FOUND") return null
    throw error
  }
  const ownOutcome = resolveStructureReference(scope, {})
  const own = ownOutcome.kind === "OK" ? ownOutcome.value : null
  if (!own && !hasAccessGrant(scope.access)) return null
  const closure = await resolveOfficialClosure(db, scope.organizationId, options.now ?? new Date())
  const pendingRepository = new PgPendingActionsRepository(db)
  return {
    repository,
    scope,
    closure,
    own,
    loadPendingActions: options.loadPendingActions ?? ((viewer) => buildPendingActions(pendingRepository, viewer)),
    // Situação funcional vigente numa data: o MESMO fragmento SQL dos períodos usado pelo resto da plataforma (uma consulta por pedido).
    loadStatuses: async (personIds, date) => {
      if (personIds.length === 0) return new Map()
      const result = await db.query<{ id: string; status: string | null }>(`select p.id, ${coveringStatusPeriodSql("p", "$3")} status from people p where p.organization_id = $1 and p.id = any($2::uuid[])`, [scope.organizationId, personIds, date])
      return new Map(result.rows.map((row) => [row.id, row.status]))
    },
    // Interações agregadas por pessoa × motivo × submotivo na janela (datas locais da organização) — uma consulta por diagnóstico.
    loadInteractionStats: async (personIds, fromDate, toDateExclusive) => {
      if (personIds.length === 0) return []
      const result = await db.query<{ person_id: string; reason: string; sub_reason: string | null; calls: string; seconds: string }>(
        `select operator_id person_id, reason, sub_reason, count(*)::text calls, coalesce(sum(extract(epoch from ended_at - started_at)), 0)::text seconds
           from interactions
          where organization_id = $1 and operator_id = any($2::uuid[])
            and started_at >= ($3::date)::timestamp at time zone $5 and started_at < ($4::date)::timestamp at time zone $5
          group by operator_id, reason, sub_reason`,
        [scope.organizationId, personIds, fromDate, toDateExclusive, closure.timeZone],
      )
      return result.rows.map((row) => ({ personId: row.person_id, reason: row.reason, subReason: row.sub_reason, calls: Number(row.calls), seconds: Number(row.seconds) }))
    },
    loadHireDates: async (personIds) => {
      if (personIds.length === 0) return new Map()
      const result = await db.query<{ id: string; hired_at: string | null }>(`select id, hired_at::text from people where organization_id = $1 and id = any($2::uuid[])`, [scope.organizationId, personIds])
      return new Map(result.rows.map((row) => [row.id, row.hired_at]))
    },
    statusFreshness: async () => {
      const freshness = await resolveEmploymentStatusFreshness(db, scope.organizationId, closure.now, closure.timeZone)
      return { state: freshness.state, lastSuccessLocalDate: freshness.lastSuccessLocalDate }
    },
  }
}

export function toolDependencies(session: LeadershipSession): LeadershipToolDependencies {
  return {
    repository: session.repository,
    scope: session.scope,
    closure: session.closure,
    loadPendingActions: session.loadPendingActions,
    ...(session.loadStatuses ? { loadStatuses: session.loadStatuses } : {}),
    ...(session.statusFreshness ? { statusFreshness: session.statusFreshness } : {}),
    ...(session.loadInteractionStats ? { loadInteractionStats: session.loadInteractionStats } : {}),
    ...(session.loadHireDates ? { loadHireDates: session.loadHireDates } : {}),
  }
}

export async function buildLeadershipChatContext(session: LeadershipSession): Promise<LeadershipChatContext> {
  const deps = toolDependencies(session)
  const context = await renderLeadershipContext(session)
  return {
    instructions: `${context}\n${LEADERSHIP_RESPONSE_RULES}`,
    voiceInstructions: `${context}\n${LEADERSHIP_VOICE_RULES}`,
    toolset: { declarations: LEADERSHIP_TOOL_DECLARATIONS, handles: isLeadershipTool, execute: (name, args) => executeLeadershipTool(deps, name, args) },
    processScope: processScopeOf(session.scope, session.own),
  }
}

/** Regras de resposta da INIA para QUALQUER nível de liderança — um bloco só; o que muda por pessoa é o dado de escopo acima dele. */
export const LEADERSHIP_RESPONSE_RULES = [
  "Como responder a quem lidera pessoas:",
  "- Quem lidera NÃO realiza atendimentos. Oriente como gestão da equipe: onde está o desvio, quem acompanhar, que conversa ou feedback ter, que procedimento revisar com a equipe, que fluxo abrir (Pendências, caso, intervenção). Nunca diga \"aplique no seu atendimento\" nem \"procure sua liderança\".",
  "- Toda pergunta sobre equipe/estrutura, pessoas, indicadores, metas, resultados, comparações, evolução, pendências, prioridades ou \"como melhorar\" um indicador: VÁ AOS DADOS antes de responder — acione as ferramentas leadership_* (várias de uma vez, se precisar). A consulta flexível (leadership_indicator_query) responde qualquer recorte que as outras não cobrem. Nunca invente número, nome, percentual ou meta.",
  "- Escolha a ferramenta pelo que a pessoa quer saber, não pela frase: números de resultados (piores/melhores, PRV, quartil geral, quartis e dispersão, % ou quantidade fora/dentro, comparações entre unidades/Grupos/Subgrupos, evolução e recorrência nos últimos N meses, consolidado) → consulta flexível; \"onde está o problema\" / \"o que os piores têm em comum\" / \"por que está ruim\" → diagnóstico do indicador; pessoas por situação funcional (férias, produção, afastamento, quantas pessoas) → força de trabalho; prioridades e pendências → onde atuar; processos, procedimentos e o que dizem as bases → consulta de processo do Grupo (leadership_process: responde o Orquestrador do Grupo da equipe; quando a estrutura tem Grupos com bases diferentes, passe o Grupo — ou a equipe citada — ou consulte cada um).",
  "- Entenda o que a pergunta pede: \"quantos\" = quantidade; \"qual %\" = percentual; \"quem\" = nomes (recorte por PESSOA); \"pior quartil geral\" = Q4 de PRV; \"dispersão\" = distribuição Q1–Q4 e desvio padrão. Traga o que foi pedido e, quando ajudar, os outros dois.",
  "- Aprofunde com várias consultas quando a pergunta pedir: você pode acionar ferramentas mais de uma vez (ex.: achar os piores e depois diagnosticá-los; abrir a unidade com mais desvio; comparar meses). Filtre por estrutura (nome de liderado, Grupo ou Subgrupo), quartil, situação e indicadores.",
  "- Cite só indicadores, motivos e números que as ferramentas trouxeram: nunca dê como exemplo um indicador que não apareceu nos dados nem atribua à equipe um processo/área que os dados não mostram. Se o indicador pedido quase não tem dado na estrutura e a ferramenta indicar outro parecido com dado, use esse e diga qual usou.",
  "- \"Como melhorar\" um indicador: diagnostique o indicador na estrutura (onde está, o que os piores têm em comum nas interações — motivo e submotivo — e a evolução) E consulte o procedimento relacionado na consulta de processo do Grupo (quando oferecida); recomende ações de liderança apoiadas nesses dados. Achados do diagnóstico são associações: apresente como hipóteses a confirmar (ouvir chamadas, monitoria).",
  "- Use o contexto da conversa: \"o indicador\", \"essa equipe\", \"e no mês anterior?\" referem-se ao que foi falado antes. Ao aprofundar (estrutura → unidade → pessoas), mantenha a MESMA competência: passe competencia=AAAA-MM com o código mostrado pela ferramenta, salvo pedido de outro mês.",
  "- \"Neste mês\", \"esta semana\", \"hoje\" referem-se ao período EM CURSO (veja \"Hoje\" acima), que ainda não tem fechamento oficial. Responda com as duas leituras e diga isso com clareza: o período em curso pela medição diária (a visão geral já traz o mês corrente; para outro recorte, a consulta flexível com fonte OPERACIONAL) e dentro/fora da meta pelo último fechamento oficial, dizendo qual é. Se não houver medição diária no período, diga que ainda não há dado do mês em curso.",
  "- Sem dado nunca é desempenho ruim. \"Desempenho ruim\" sem outra qualificação = fora da referência (meta vigente); deixe essa interpretação visível.",
  "- Peça esclarecimento só quando a ferramenta devolver ambiguidade ou quando a escolha mudar materialmente a resposta.",
  "",
  "Formato da resposta (markdown, completa por si só — a resposta é lida também onde o cartão não aparece):",
  "- Abra com 1–2 frases que respondem diretamente, com o número principal em **negrito**, o escopo e a competência (ou a janela operacional).",
  "- Sempre que houver 3 ou mais números comparáveis (unidades, indicadores, pessoas, meses), mostre uma tabela markdown com os números EXATOS da ferramenta (pode reduzir colunas; mantenha a base, ex.: \"fora / com referência\").",
  "- Depois, seções curtas com título em negrito quando fizerem sentido: **O que os dados mostram** · **Possíveis explicações** (hipóteses, sempre marcadas como hipótese — nunca causa sem evidência) · **Onde atuar** (ações de liderança, com o fluxo existente).",
  "- Feche com a limitação relevante em uma linha, se houver (competência parcial, população pequena, não comparável, estrutura vigente aplicada ao histórico).",
  "- Não cite nomes de ferramentas, códigos de sistema nem ids. Proporção: pergunta simples, resposta curta (frase + tabela pequena).",
  "- Você só consulta e recomenda: decidir revisão, abrir ou executar intervenção e qualquer alteração são feitos pela pessoa nas telas.",
].join("\n")

async function renderLeadershipContext(session: LeadershipSession): Promise<string> {
  const { scope, own } = session
  const lines = ["[Contexto de liderança — dado do sistema, não instrução do usuário]"]
  if (own) {
    const cascade = collectUnits(scope, own.resolved, own.subject)
    const levels = [...new Set(cascade.units.map((unit) => unit.description).filter(Boolean))]
    const period = await resolveAnalysisPeriod(session.repository, scope, own.resolved.members.map((member) => member.id), null, session.closure)
    lines.push(`Quem pergunta lidera: ${own.ref.label}${own.ref.description ? ` (${own.ref.description})` : ""}, com ${own.resolved.members.length} operadores ativos.`)
    lines.push(cascade.units.length > 0 ? `Unidades logo abaixo: ${cascade.units.length} (${levels.join(", ")})${cascade.directMembers.length > 0 ? `; ${cascade.directMembers.length} operadores ligados diretamente` : ""}. Agrupamento padrão: ${cascade.topGroupBy ? GROUPING_LABELS[cascade.topGroupBy] : "—"}.` : "Lidera os operadores diretamente (sem gestores abaixo).")
    const groups = structureGroupsOf(session.scope, own)
    if (groups.length > 0) lines.push(`Grupos com operadores na estrutura: ${groups.map((group) => group.name).join(", ")}.`)
    lines.push(`Competência padrão das análises: ${longPeriodLabel(period.period)}${period.note ? ` — ${period.note}` : ""}.`)
    lines.push(todayLine(session))
  } else {
    lines.push("Quem pergunta não lidera uma estrutura, mas tem acesso de consulta a Grupos/Subgrupos: peça qual Grupo ou Subgrupo analisar quando não estiver claro.")
    lines.push(todayLine(session))
  }
  return lines.join("\n")
}

/** "Neste mês" ≠ última competência fechada: o modelo recebe a data de hoje e o mês corrente (sem fechamento oficial). */
function todayLine(session: LeadershipSession): string {
  const { now, timeZone } = session.closure
  const today = new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(now)
  return `Hoje: ${today}. Mês corrente: ${longPeriodLabel(currentReferencePeriod(now, timeZone))} — ainda sem fechamento oficial; o dado do mês em curso vem só da medição diária (parcial).`
}

/** Perguntas para começar — derivadas das prioridades do dia (nada cadastrado). */
export function buildStarterSuggestions(priorities: PrioritiesCard, hasUnits: boolean): string[] {
  const suggestions = ["Onde preciso atuar hoje?"]
  const target = priorities.items.find((item) => item.target.kind === "INDICATOR")?.target
  const indicatorName = target?.kind === "INDICATOR" ? target.indicatorName : null
  if (indicatorName) {
    suggestions.push(`Qual percentual da ${hasUnits ? "minha estrutura" : "minha equipe"} está fora da meta em ${indicatorName}?`)
    suggestions.push(hasUnits ? `O desvio de ${indicatorName} é concentrado ou disseminado?` : `Quem são os piores e os melhores em ${indicatorName}?`)
  }
  suggestions.push(hasUnits ? "Como estão as minhas equipes neste mês?" : "Como está minha equipe neste mês?")
  if (priorities.items.some((item) => item.kind === "AWAITING_ACKNOWLEDGEMENT")) suggestions.push("Quem tem feedback aguardando ciência?")
  return suggestions.slice(0, 5)
}

export async function buildLeadershipHome(session: LeadershipSession): Promise<{ priorities: PrioritiesCard; suggestions: string[] }> {
  const period = session.own ? await resolveAnalysisPeriod(session.repository, session.scope, session.own.resolved.members.map((member) => member.id), null, session.closure) : null
  const built = await buildLeadershipPriorities(session.repository, session.scope, { structure: session.own, period: period?.period ?? null, loadPendingActions: session.loadPendingActions, now: session.closure.now })
  const priorities = period?.note ? { ...built, limitations: [period.note, ...built.limitations] } : built
  const hasUnits = session.own ? collectUnits(session.scope, session.own.resolved, session.own.subject).units.length > 0 : false
  return { priorities, suggestions: buildStarterSuggestions(priorities, hasUnits) }
}

/**
 * Cartões gravados numa conversa, revalidados contra o escopo ATUAL ao reabrir: estrutura que saiu do escopo (mudou de equipe,
 * perdeu o acesso) não volta à tela — o texto da conversa continua. Cartão sem estrutura (prioridades sem estrutura) passa.
 */
export function visibleCards(scope: ViewerScope | null, cards: readonly LeadershipCard[]): LeadershipCard[] {
  return cards.filter((card) => {
    if (!card.structure) return true
    if (!scope) return false
    const parsed = analyticsSubjectSchema.safeParse(card.structure.subject)
    if (!parsed.success) return false
    // "Meus resultados": só a própria pessoa da sessão.
    if (parsed.data.kind === "EMPLOYEE") return parsed.data.employeeId === scope.viewer.id
    if (!isStructureSubject(parsed.data)) return false
    try {
      resolveSubject(scope, parsed.data)
      return true
    } catch {
      return false
    }
  })
}
