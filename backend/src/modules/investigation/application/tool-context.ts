import type { Database } from "../../../infrastructure/database/pool.js"
import { loadIndicatorOperationalDefinition, type IndicatorOperationalDefinition, type WorkdayResolutionCache } from "../../indicators/application/operational-measurement-resolver.js"
import { startOfLocalDate, localDateOf, type TimeWindow } from "../../workflows/application/time-window.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { ToolProvenance } from "../domain/tool-output.js"
import type { LlmPhase, LlmRouteRecord, LlmUsage } from "../../../shared/application/llm-telemetry.js"
import type { HandleRegistry } from "../domain/handle-registry.js"

/** Uma request ao modelo feita durante a investigação (planejamento, notas, análise semântica) — só números do provider. */
export type InvestigationRequest = { phase: LlmPhase; model: string; usage: LlmUsage; durationMs: number; toolCalls: string[]; route?: LlmRouteRecord; /** V1.4.6 (§26): estágio dentro da análise semântica — extração × síntese × sidecar, para isolar o custo do procedural. */ stage?: "EXTRACTION" | "SYNTHESIS" | "SIDECAR" | "NEED_KIND" }

/**
 * SUJEITO da investigação — decidido pelo runtime (Workflow, chat, QA), nunca pelo modelo. As
 * Tools só enxergam este colaborador (e, para comparações, populações AGREGADAS em volta dele).
 */
export type InvestigationSubject = {
  operatorId: string
  operatorName: string | null
  teamId: string | null
  teamName: string | null
  subteamId: string | null
  subteamName: string | null
  /** Interação em foco (feedback de chamada) — as Tools de interação usam por padrão. */
  interactionId: string | null
  /** Indicador em foco (feedback de indicador) — só uma dica ao modelo; qualquer código do catálogo é aceito. */
  indicatorCode: string | null
}

export type InvestigationPeriod = TimeWindow & { label: string }

/** Candidato real de material de apoio acumulado por `query_knowledge` nesta investigação. */
export type KnowledgeCandidate = { materialId: string; title: string }

/** V1.4.5: trecho recuperado da base (documento + seção + texto) — evidência normativa, verificada literalmente. */
export type KnowledgeExcerptRecord = { documentId: string; documentTitle: string; heading: string; excerpt: string }

export type ToolContext = {
  db: Database
  organizationId: string
  /**
   * Agent cuja base autorizada alimenta `query_knowledge` e a recuperação dirigida da Fase K. null = análise semântica
   * DIRETA sem Agent (feedback de atendimento V1.5.10): a Fase K só compara com trechos já presentes (nenhum, nesse fluxo)
   * — nunca busca em base não autorizada.
   */
  agentId: string | null
  /** V1.5.10: fluxo que originou a análise semântica — só vira etiqueta de custo (`flow:*`) na classificação das requests. */
  semanticFlow?: "INTERACTION_FEEDBACK" | undefined
  now: Date
  timeZone: string
  subject: InvestigationSubject
  /** Período padrão desta investigação (do Workflow/chamada); as Tools aceitam outro explicitamente. */
  defaultPeriod: InvestigationPeriod
  /** Memo por investigação da resolução de dias de trabalho — reaproveitado por todas as Tools. */
  workdayCache: WorkdayResolutionCache
  /** Materiais reais já consultados (query_knowledge) — o único universo que recommend_support_materials aceita. */
  knowledgeCandidates: Map<string, KnowledgeCandidate>
  /**
   * V1.4.5: TRECHOS reais já recuperados da base nesta execução (por `query_knowledge`), indexados por documento+seção.
   * É o único insumo autorizado da extração de KnowledgeRule — a aplicação nunca usa conhecimento geral (§14).
   */
  knowledgeExcerpts?: Map<string, KnowledgeExcerptRecord>
  /** Fatos já coletados (resumos), pra synthesize_evidence organizar sem recalcular. */
  collectedFacts: { tool: string; label: string; summary: string; provenance: ToolProvenance | null }[]
  /** Requests ao modelo feitas por Tools com LLM (analyze_*) — somadas ao Token Budget da investigação. */
  telemetry: { requests: InvestigationRequest[] }
  /** Handles curtos (I1/K1/M1) desta execução — o modelo nunca vê UUID (handle-registry.ts). */
  handles: HandleRegistry
  /**
   * ESTADO INVESTIGATIVO compartilhado com as Tools (V1.3.2): o objetivo derivado + necessidades/hipóteses
   * materiais abertas (para a análise semântica saber POR QUE analisa), o universo registrado (para a
   * semântica de contagem) e a estratégia de amostragem decidida pelo runtime. O runtime atualiza a cada rodada.
   */
  investigation: InvestigationToolState
}

/** Estado padrão (Tools fora do runtime — provas, testes): amostra recente, universo desconhecido, sem objetivo derivado. */
export function defaultInvestigationToolState(): InvestigationToolState {
  return { analysisObjective: null, recordedUniverseCount: null, samplingStrategy: "RECENT", temporalBuckets: 1 }
}

export type InvestigationToolState = {
  analysisObjective: import("../domain/interaction-analysis.js").InteractionAnalysisObjective | null
  /** Interações registradas do colaborador no período padrão (preflight) — null = desconhecido. */
  recordedUniverseCount: number | null
  /** Amostragem padrão de find_interactions decidida pelo runtime a partir do objetivo/janela (sampling-strategy.ts). */
  samplingStrategy: import("../domain/sampling-strategy.js").SamplingStrategy
  /** Blocos temporais da janela padrão (cobertura temporal da análise). */
  temporalBuckets: number
}

/** Janela [início, fim) a partir de datas locais inclusivas — ou o período padrão. */
export function resolvePeriod(context: ToolContext, period: { from: string; to: string } | undefined): InvestigationPeriod {
  if (!period) return context.defaultPeriod
  const start = startOfLocalDate(period.from, context.timeZone)
  const endInclusive = startOfLocalDate(period.to, context.timeZone)
  if (Number.isNaN(start.getTime()) || Number.isNaN(endInclusive.getTime())) throw new DomainError("Período inválido.", "TOOL_INVALID_PERIOD", 422)
  if (endInclusive < start) throw new DomainError("O fim do período é anterior ao início.", "TOOL_INVALID_PERIOD", 422)
  const end = new Date(endInclusive.getTime() + 24 * 60 * 60 * 1000)
  // Nunca no futuro: o fim é limitado ao início do dia seguinte a "agora" local.
  const cap = new Date(startOfLocalDate(localDateOf(context.now, context.timeZone), context.timeZone).getTime() + 24 * 60 * 60 * 1000)
  const boundedEnd = end > cap ? cap : end
  return { start, end: boundedEnd, label: `${period.from} a ${localDateOf(new Date(boundedEnd.getTime() - 1), context.timeZone)}` }
}

/** Período imediatamente anterior, de mesmo tamanho. */
export function previousPeriodOf(period: InvestigationPeriod, timeZone: string): InvestigationPeriod {
  const length = period.end.getTime() - period.start.getTime()
  const start = new Date(period.start.getTime() - length)
  return { start, end: period.start, label: `${localDateOf(start, timeZone)} a ${localDateOf(new Date(period.start.getTime() - 1), timeZone)}` }
}

export function describeWindow(period: InvestigationPeriod): ToolProvenance["period"] {
  return { start: period.start.toISOString(), end: period.end.toISOString(), label: period.label }
}

export type IndicatorInfo = IndicatorOperationalDefinition & { name: string; minimumSampleSize: number | null; minimumCoverage: number | null; active: boolean; officialClosureSupported: boolean }

/** Indicador do catálogo (por código) — inexistente é erro da Tool (o modelo recebe a lista real). */
export async function loadIndicator(context: ToolContext, indicatorCode: string): Promise<IndicatorInfo> {
  const definition = await loadIndicatorOperationalDefinition(context.db, context.organizationId, indicatorCode)
  const row = definition
    ? await context.db.query<{ name: string; minimum_sample_size: number | null; minimum_coverage: string | null; active: boolean; official_closure_supported: boolean; organization_id: string }>(
        `select name, minimum_sample_size, minimum_coverage, active, official_closure_supported, organization_id from indicator_definitions where id = $1`,
        [definition.id],
      )
    : null
  const meta = row?.rows[0]
  if (!definition || !meta || meta.organization_id !== context.organizationId) {
    const known = await context.db.query<{ code: string }>(`select code from indicator_definitions where organization_id = $1 and active order by code`, [context.organizationId])
    throw new DomainError(`Indicador "${indicatorCode}" não existe no catálogo. Códigos válidos: ${known.rows.map((item) => item.code).join(", ")}.`, "TOOL_INVALID_INDICATOR", 422)
  }
  return {
    ...definition,
    name: meta.name,
    minimumSampleSize: meta.minimum_sample_size,
    minimumCoverage: meta.minimum_coverage === null ? null : Number(meta.minimum_coverage),
    active: meta.active,
    officialClosureSupported: meta.official_closure_supported,
  }
}

/** População mínima de uma comparação agregada (mesmo mínimo do quartil operacional). */
export const MINIMUM_COMPARISON_POPULATION = 4

export type PeerPopulation = { ids: string[]; label: string; kind: "SUBGROUP" | "GROUP" }

/** Pares ATIVOS (operadores) do Subgrupo ou do Grupo do colaborador, sem ele. */
export async function loadPeerPopulation(context: ToolContext, reference: "SUBGROUP" | "GROUP"): Promise<PeerPopulation | null> {
  const { subject } = context
  if (reference === "SUBGROUP") {
    if (!subject.subteamId) return null
    const peers = await context.db.query<{ id: string }>(`select id from people where organization_id = $1 and role = 'OPERATOR' and active and subteam_id = $2 and id <> $3`, [context.organizationId, subject.subteamId, subject.operatorId])
    return { ids: peers.rows.map((row) => row.id), label: `Subgrupo ${subject.subteamName ?? ""}`.trim(), kind: "SUBGROUP" }
  }
  if (!subject.teamId) return null
  const peers = await context.db.query<{ id: string }>(`select id from people where organization_id = $1 and role = 'OPERATOR' and active and team_id = $2 and id <> $3`, [context.organizationId, subject.teamId, subject.operatorId])
  return { ids: peers.rows.map((row) => row.id), label: `Grupo ${subject.teamName ?? ""}`.trim(), kind: "GROUP" }
}

/** Sujeito a partir do colaborador — organização e vínculo verificados pelo banco. */
export async function loadSubject(db: Database, organizationId: string, operatorId: string, extra: { interactionId?: string | null; indicatorCode?: string | null } = {}): Promise<InvestigationSubject> {
  const row = await db.query<{ name: string; team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null }>(
    `select p.name, p.team_id, t.name team_name, p.subteam_id, st.name subteam_name
     from people p left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id
     where p.id = $1 and p.organization_id = $2`,
    [operatorId, organizationId],
  )
  const person = row.rows[0]
  if (!person) throw new DomainError("Colaborador não encontrado nesta organização.", "INVESTIGATION_SUBJECT_NOT_FOUND", 404)
  return {
    operatorId,
    operatorName: person.name,
    teamId: person.team_id,
    teamName: person.team_name,
    subteamId: person.subteam_id,
    subteamName: person.subteam_name,
    interactionId: extra.interactionId ?? null,
    indicatorCode: extra.indicatorCode ?? null,
  }
}
