import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { METRIC_BY_ID, USABILITY_DEFINITIONS_VERSION } from "../../domain/metric-dictionary.js"
import { buildCsv, type CsvCell } from "../../domain/usability-csv.js"
import { describePeriod } from "../../domain/usage-time.js"
import { conversationsQuery } from "./conversations-query.js"
import { feedbacksQuery } from "./feedbacks-query.js"
import { journeysQuery } from "./journeys-query.js"
import { overviewQuery } from "./overview-query.js"
import { PEOPLE_SEGMENT_LABELS, peopleQuery } from "./people-query.js"
import { qualityQuery } from "./quality-query.js"
import { retentionQuery } from "./retention-query.js"
import { screensQuery } from "./screens-query.js"
import { describeAppliedFilters } from "./usability-filters.js"
import type { UsabilityContext } from "./usability-context.js"
import { workflowsQuery } from "./workflows-query.js"

/**
 * EXPORTAÇÃO CSV — cada tabela é produzida pela MESMA função de consulta do painel (mesmo recorte, corte temporal e versão
 * das definições): tela, API e CSV reconciliam. Recorte completo, nunca só a página visível; acima do limite, a exportação é
 * recusada com orientação para estreitar os filtros (sem arquivo parcial). Linhas identificadas exigem permissão de pessoas;
 * comentários exigem a permissão de comentários e pedido explícito (tabela própria).
 */
type Queryable = Pick<Database, "query">
export const EXPORT_ROW_LIMIT = 10_000

export const EXPORT_TABLES = {
  overview: ["kpis", "series", "heatmap", "screens"],
  people: ["people", "segments", "retention"],
  screens: ["screens", "features", "elements", "transitions", "scroll", "search", "filters"],
  feedbacks: ["cohort", "items", "reasons", "confirmation", "comments"],
  conversations: ["summary", "origins", "items"],
  workflows: ["ranking", "items", "failures"],
  journeys: ["funnels", "signals"],
  quality: ["families", "ingestion", "catalog", "dictionary", "events"],
} as const
export type ExportTab = keyof typeof EXPORT_TABLES

const IDENTIFIED = new Set(["people:people", "feedbacks:items", "conversations:items", "workflows:items"])
const pct = (value: number | null | undefined) => (value === null || value === undefined ? null : value)

function guard(ctx: UsabilityContext, tab: string, table: string) {
  if (IDENTIFIED.has(`${tab}:${table}`) && !ctx.can.people) throw new DomainError("Exportar pessoas identificadas exige permissão para ver pessoas.", "USABILITY_PEOPLE_FORBIDDEN", 403)
  if (tab === "feedbacks" && table === "comments" && !ctx.can.comments) throw new DomainError("Exportar comentários exige permissão específica.", "USABILITY_COMMENTS_FORBIDDEN", 403)
}

function tooLarge(total: number) {
  if (total > EXPORT_ROW_LIMIT) throw new DomainError(`O recorte tem ${total} linhas — acima do limite de ${EXPORT_ROW_LIMIT} por arquivo. Estreite o período ou os filtros.`, "USABILITY_EXPORT_TOO_LARGE", 413)
}

export async function buildUsabilityExport(db: Queryable, ctx: UsabilityContext, tab: ExportTab, table: string): Promise<{ filename: string; csv: string; rows: number }> {
  if (!(EXPORT_TABLES[tab] as readonly string[]).includes(table)) throw new DomainError("Tabela de exportação inválida.", "USABILITY_EXPORT_INVALID", 400)
  guard(ctx, tab, table)
  let header: string[] = []
  let rows: CsvCell[][] = []
  let coverage = "Ver Qualidade da medição"
  const coverageText = (value: { status: string; from: string | null } | undefined) => (value ? `${value.status}${value.from ? ` desde ${value.from}` : ""}` : "—")

  if (tab === "overview") {
    const data = await overviewQuery(db, ctx)
    coverage = `Atividade: ${coverageText(data.meta.coverage.activity)} · Elegibilidade: ${coverageText(data.meta.coverage.eligibility)}`
    if (table === "kpis") {
      header = ["Métrica", "Definição", "Estado", "Valor", "Numerador", "Base", "Cobertura", "Anterior", "Variação", "Tipo da variação"]
      rows = data.kpis.map((kpi) => [METRIC_BY_ID.get(kpi.metric)?.label ?? kpi.metric, METRIC_BY_ID.get(kpi.metric)?.definition ?? "", kpi.status, kpi.value, kpi.numerator, kpi.denominator, coverageText(kpi.coverage), kpi.variation?.previous ?? null, kpi.variation?.value ?? null, kpi.variation?.status === "VALUE" ? kpi.variation.kind : kpi.variation?.label ?? null])
    } else if (table === "series") {
      header = ["Data", "Medido", "DAU", "WAU (7 dias móveis)", "WAU com cobertura completa", "MAU (30 dias móveis)", "MAU com cobertura completa", "Sessões iniciadas", "Tempo ativo (s)"]
      rows = data.series.map((row) => [row.date, row.measured, row.dau, row.wau, row.wauFullCoverage, row.mau, row.mauFullCoverage, row.sessions, row.activeSeconds])
    } else if (table === "heatmap") {
      header = ["Dia da semana (1=segunda)", "Hora", "Sessões iniciadas"]
      rows = data.heatmap.map((row) => [row.weekday, row.hour, row.sessions])
    } else {
      header = ["Tela", "Visualizações", "Pessoas", "Participação (%)"]
      rows = data.topScreens.map((row) => [row.label, row.views, row.people, pct(row.sharePercent)])
    }
  } else if (tab === "people") {
    if (table === "retention") {
      const data = await retentionQuery(db, ctx)
      header = ["Janela", "Coorte madura", "Coorte imatura", "Retornaram", "Taxa (%)", "Retorno acumulado"]
      rows = data.days.map((row) => [row.label, row.matureCohort, row.immature, row.returned, pct(row.rate), row.cumulativeReturned])
    } else {
      const counts = await peopleQuery(db, ctx)
      if (table === "segments") {
        header = ["Segmento", "Pessoas"]
        rows = Object.entries(counts.counts).map(([segment, value]) => [PEOPLE_SEGMENT_LABELS[segment as keyof typeof PEOPLE_SEGMENT_LABELS], value])
      } else {
        tooLarge(counts.total)
        const data = await peopleQuery(db, ctx, { all: true })
        header = ["Pessoa", "Matrícula", "Cargo", "Nível", "Grupo", "Subgrupo", "Situação", "Conta", "Papéis de acesso", "Elegível agora", "Elegível desde", "Ativa no período", "Engajada", "Dias ativos", "Sessões", "Sessões por dia ativo", "Tempo ativo (s)", "Primeiro acesso observado", "Último acesso observado", "Último login conhecido antes da coleta"]
        rows = (data.items ?? []).map((row) => [row.name, row.matricula, row.jobTitle, row.level, row.teamName, row.subteamName, row.employmentStatus, row.accountStatus, row.roles.join(", "), row.eligibleNow, row.eligibleFrom ? new Date(row.eligibleFrom) : null, row.activeInPeriod, row.engagedInPeriod, row.activeDays, row.sessions, row.sessionsPerActiveDay, row.activeSeconds, row.firstObservedAt ? new Date(row.firstObservedAt) : null, row.lastObservedAt ? new Date(row.lastObservedAt) : null, row.legacyLastLoginAt ? new Date(row.legacyLastLoginAt) : null])
        coverage = `Atividade: ${coverageText(data.meta.coverage.activity)} · Segmento: ${data.segmentLabel}`
      }
    }
  } else if (tab === "screens") {
    const data = await screensQuery(db, ctx)
    coverage = `Navegação: ${coverageText(data.meta.coverage.navigation)} · Elementos: ${coverageText(data.meta.coverage.elements)}`
    const tables: Record<string, () => void> = {
      screens: () => { header = ["Tela", "Área", "Visualizações", "Pessoas", "Sessões", "Tempo ativo mediano (s)", "Tempo ativo p95 (s)", "Participação (%)"]; rows = data.screens.map((row) => [row.label, row.area, row.views, row.people, row.sessions, row.medianActiveSeconds, row.p95ActiveSeconds, pct(row.sharePercent)]) },
      features: () => { header = ["Funcionalidade", "Pessoas", "Eventos", "Pessoas recorrentes (2+ dias)", "Ações confirmadas", "Falhas"]; rows = data.features.map((row) => [row.label, row.people, row.events, row.recurrentPeople, row.succeeded, row.failed]) },
      elements: () => { header = ["Elemento", "Tela", "Acionamentos", "Pessoas", "Exposição medida", "Pessoas expostas", "Pessoas expostas que acionaram", "Taxa de acionamento (%)"]; rows = data.elements.map((row) => [row.label, row.screenLabel, row.activations, row.people, row.exposureMeasured, row.exposedPeople, row.activatedAmongExposed, pct(row.activationRate)]) },
      transitions: () => { header = ["De", "Para", "Transições"]; rows = data.transitions.map((row) => [row.fromLabel, row.toLabel, row.count]) },
      scroll: () => { header = ["Conteúdo", "Visualizações", "25%", "50%", "75%", "100%", "Cabe na tela"]; rows = data.scroll.map((row) => [row.label, row.views, row.reached[25], row.reached[50], row.reached[75], row.reached[100], row.fitsViewport]) },
      search: () => { header = ["Superfície", "Buscas", "Sem resultado", "Resultado aberto", "Pessoas"]; rows = data.search.map((row) => [row.label, row.searches, row.empty, row.resultOpened, row.people]) },
      filters: () => { header = ["Superfície", "Filtro", "Usos", "Pessoas"]; rows = data.filters.map((row) => [row.surface, row.filterKey, row.uses, row.people]) },
    }
    tables[table]!()
  } else if (tab === "feedbacks") {
    const data = await feedbacksQuery(db, ctx, { listAll: table === "items" })
    coverage = `Exposição: ${coverageText(data.meta.coverage.exposure)} · ${data.meta.cohort.label}`
    if (table === "cohort") {
      header = ["Taxa", "Numerador", "Base", "Valor (%)"]
      rows = Object.entries(data.cohort.rates).map(([key, value]) => [key, value.numerator, value.denominator, pct(value.value)])
      rows.push(["Exposição não medida (itens)", data.cohort.exposureNotMeasured, data.cohort.available, null], ["Coorte imatura (itens)", data.meta.cohort.immature, data.cohort.available, null])
    } else if (table === "items") {
      tooLarge(data.total)
      header = ["Fonte", "Id da fonte", "Destinatário", "Grupo", "Tipo", "Disponibilizado em", "Coorte madura", "Exposição medida", "Exposto em", "Aberto em", "Aberturas", "Avaliação vigente", "Ciência em", "Aplicação iniciada em", "Aplicação concluída em"]
      rows = (data.items ?? []).map((row) => [row.sourceKind as string, row.sourceId as string, row.recipientName as string, row.teamName as string, row.feedbackKind as string, dateOrNull(row.availableAt), row.mature as boolean, row.exposureMeasured as boolean, dateOrNull(row.exposedAt), dateOrNull(row.openedAt), row.openCount as number, row.currentRating as string, dateOrNull(row.acknowledgedAt), dateOrNull(row.applicationStartedAt), dateOrNull(row.applicationCompletedAt)])
    } else if (table === "reasons") {
      header = ["Motivo", "Avaliações negativas no período", "No período anterior"]
      rows = data.reasons.map((row) => [row.label, row.count, row.previous])
    } else if (table === "confirmation") {
      const c = data.confirmation
      header = ["Indicador", "Valor"]
      rows = [["Tentativas", c.attempts], ["Formulários abertos", c.opened], ["Tentativas com envio", c.submitted], ["Falhas", c.failures], ["Tentativas com falha", c.withFailure], ["Recuperadas após falha", c.recovered], ["Canceladas", c.cancelled], ["Ciências novas", c.confirmedNew], ["Confirmações repetidas (idempotentes)", c.confirmedIdempotent], ["Aplicações concluídas pela confirmação", c.completedApplication], ["Pendentes", c.pending], ["Possível abandono", c.possibleAbandonment], ["Tempo até o 1º envio — mediana (s)", c.timeToFirstSubmit.median], ["Tempo até confirmar — mediana (s)", c.timeToConfirm.median]]
    } else {
      header = ["Data", "Motivo", "Comentário", "Pessoa", "Fonte", "Id da fonte"]
      rows = (data.comments ?? []).map((row) => [new Date(row.createdAt), row.reasonLabel, row.comment, row.personName, row.sourceKind, row.sourceId])
    }
  } else if (tab === "conversations") {
    const data = await conversationsQuery(db, ctx, { listAll: table === "items" })
    coverage = `Mensagens: ${coverageText(data.meta.coverage.messages)} · Voz: ${coverageText(data.meta.coverage.voice)}`
    if (table === "summary") {
      header = ["Indicador", "Valor"]
      rows = [["Pessoas que usaram", data.people.used], ["Pessoas por texto", data.people.text], ["Pessoas por voz", data.people.voice], ["Pessoas texto e voz", data.people.both], ["Mensagens de texto da pessoa", data.messages.userText], ["Turnos de voz da pessoa", data.messages.userVoiceTurns], ["Mensagens de texto da INIA", data.messages.iniaText], ["Respostas em áudio da INIA", data.messages.iniaVoice], ["Conversas criadas", data.conversations.created], ["Conversas com participação humana", data.conversations.withHumanParticipation], ["Só texto", data.conversations.textOnly], ["Só voz", data.conversations.voiceOnly], ["Mistas", data.conversations.mixed], ["Taxa de resposta (%)", pct(data.responseRate.value)], ["Turnos elegíveis à resposta", data.responseRate.eligible], ["Conexões de voz estabelecidas", data.voice.established], ["Conexões com fala", data.voice.withSpeech], ["Conexões sem fala", data.voice.withoutSpeech], ["Falhas de conexão", data.voice.failed], ["Microfone negado", data.voice.permissionDenied]]
    } else if (table === "origins") {
      header = ["Origem", "Tipo", "Conversas", "Mensagens humanas", "Mensagens da INIA", "Pessoas"]
      rows = data.origins.map((row) => [row.origin, row.kind, row.conversations, row.humanMessages, row.iniaMessages, row.people])
    } else {
      header = ["Conversa", "Pessoa", "Origem", "Tipo", "Mensagens de texto", "Turnos de voz", "Mensagens da INIA", "Primeira", "Última"]
      rows = (data.items ?? []).map((row) => [row.conversationId as string, row.ownerName as string, row.origin as string, row.kind as string, row.userText as number, row.userVoice as number, row.inia as number, dateOrNull(row.firstAt), dateOrNull(row.lastAt)])
      tooLarge(rows.length)
    }
  } else if (tab === "workflows") {
    const data = await workflowsQuery(db, ctx, { listAll: table === "items" })
    coverage = `Execuções: ${coverageText(data.meta.coverage.enrollments)}`
    if (table === "ranking") {
      header = ["Workflow", "Ativo", "Gatilho", "Execuções raiz", "Participação (%)", "Manual", "Interação", "Indicador", "Agenda", "Execuções filhas", "Pessoas alcançadas", "Concluídas", "Falhas", "Aguardando", "Em andamento", "Taxa de falha (%)", "Duração mediana (s)", "Duração p95 (s)", "Feedbacks entregues", "Feedbacks abertos", "Saídas entregues", "Saídas consumidas"]
      rows = data.ranking.map((row) => [row.name as string, row.active as boolean, row.triggerKind as string, row.roots, pct(row.sharePercent), row.byOrigin.MANUAL, row.byOrigin.INTERACTION, row.byOrigin.INDICATOR, row.byOrigin.SCHEDULE, row.children, row.peopleReached, row.completed, row.failed, row.waiting, row.running, pct(row.failureRate.value), row.duration.median, row.duration.p95, row.results.feedbacksDelivered, row.results.feedbacksOpened, row.results.outputsDelivered, row.results.outputsConsumed])
    } else if (table === "failures") {
      header = ["Etapa (nó)", "Código", "Categoria", "Eventos", "Raízes afetadas"]
      rows = data.failures.map((row) => [row.nodeId, row.errorCode, row.errorCategory, row.events, row.rootsAffected])
    } else {
      header = ["Raiz", "Workflow", "Versão", "Origem", "Estado", "Criada em", "Atualizada em", "Sujeito", "Solicitante", "Filhas", "Feedbacks", "Feedbacks abertos", "Saídas", "Saídas consumidas"]
      rows = (data.items ?? []).map((row) => [row.rootId as string, row.workflowName as string, row.versionId as string, row.originLabel as string, row.status as string, dateOrNull(row.createdAt), dateOrNull(row.updatedAt), row.subjectName as string, row.requesterName as string, row.children as number, row.feedbacks as number, row.feedbacksOpened as number, row.outputs as number, row.outputsConsumed as number])
      tooLarge(rows.length)
    }
  } else if (tab === "journeys") {
    const data = await journeysQuery(db, ctx)
    if (table === "funnels") {
      header = ["Funil", "Etapa", "Entidades", "Conversão da etapa anterior (%)", "Conversão total (%)", "Pendentes (janela aberta)", "Pararam aqui", "Tempo desde o início — mediana (s)", "p95 (s)"]
      rows = data.funnels.flatMap((funnel) => funnel.steps.map((step) => [funnel.label, step.label, step.reached, pct(step.conversionFromPrevious), pct(step.conversionFromStart), step.pending, step.stopped, step.timeFromStart?.median ?? null, step.timeFromStart?.p95 ?? null]))
    } else {
      header = ["Sinal (heurística)", "Valor", "Base", "Taxa (%)", "Anterior", "Evidência"]
      rows = data.signals.map((signal) => [signal.label, signal.value, signal.base, pct(signal.rate), signal.previous, signal.evidence])
    }
  } else {
    const data = await qualityQuery(db, ctx)
    const tables: Record<string, () => void> = {
      families: () => { header = ["Família", "Primeiro evento", "Último evento", "Último recebimento", "Cobertura no período"]; rows = data.families.map((row) => [row.label, dateOrNull(row.firstEventAt), dateOrNull(row.lastEventAt), dateOrNull(row.lastReceivedAt), row.coverage.status]) },
      ingestion: () => { header = ["Indicador", "Valor"]; rows = [["Lotes", data.ingestion.batches], ["Eventos recebidos", data.ingestion.received], ["Aceitos", data.ingestion.accepted], ["Duplicados", data.ingestion.duplicates], ["Recusados", data.ingestion.rejected], ...data.ingestion.rejections.map((row) => [`Recusados: ${row.label}`, row.count] as CsvCell[])] },
      catalog: () => { header = ["Tela", "Tipo", "Área", "Rota", "Instrumentação", "Primeira visualização observada", "Visualizações"]; rows = data.catalog.map((row) => [row.label, row.kind, row.areaLabel, row.routeTemplate, row.instrumentation, dateOrNull(row.firstObservedAt), row.views]) },
      dictionary: () => { header = ["Métrica", "Aba", "Definição", "Fórmula", "Unidade", "Fonte", "Base", "Deduplicação", "Cobertura", "Exclusões", "Limitações"]; rows = data.dictionary.map((row) => [row.label, row.tab, row.definition, row.formula, row.unit, row.source, row.denominator, row.dedupe, row.coverage, row.exclusions, row.limitations]) },
      events: () => { header = ["Evento", "Família", "Emissor", "Autoridade", "Finalidade", "Momento", "Correlação", "Deduplicação", "Sensibilidade"]; rows = data.events.map((row) => [row.name, row.familyLabel, row.emitter, row.authority, row.purpose, row.moment, row.correlation, row.dedupe, row.sensitivity]) },
    }
    tables[table]!()
  }

  tooLarge(rows.length)
  const csv = buildCsv(
    { title: `${tab} › ${table}`, period: describePeriod(ctx.period), timeZone: ctx.settings.timezone, filters: JSON.stringify(describeAppliedFilters(ctx.filters)), definitionsVersion: USABILITY_DEFINITIONS_VERSION, coverage, generatedAt: ctx.now },
    header,
    rows,
  )
  return { filename: `monitoria-usabilidade-${tab}-${table}-${ctx.period.fromDate}-a-${ctx.period.toDate}.csv`, csv, rows: rows.length }
}

const dateOrNull = (value: unknown) => (typeof value === "string" ? new Date(value) : value instanceof Date ? value : null)
