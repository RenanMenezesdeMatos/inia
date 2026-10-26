import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canManageScope, coversOrganization, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { callOutcomeSchema } from "../../channel-flags/domain/call-outcome.js"
import { COMPARISON_MODES } from "../domain/comparison.js"
import { DEFAULT_SAMPLING, SAMPLING_FLOORS } from "../domain/sampling.js"
import { syntheticCorpusSchema, syntheticAnswerKeySchema } from "../domain/synthetic-corpus.js"
import { BEST_PRACTICE_ANALYSIS_LOGIC_VERSION } from "../domain/versions.js"
import { createGatewayBestPracticeModel } from "../infrastructure/gateway-best-practice-model.js"
import { createPostgresBestPracticeStore } from "../infrastructure/postgres-best-practice-store.js"
import { createRealCallCorpus } from "../infrastructure/real-call-corpus.js"
import { createSimulatedAnswerKeyModel } from "../infrastructure/simulated-answer-key-model.js"
import { createSyntheticCallCorpus } from "../infrastructure/synthetic-call-corpus.js"
import type { AnalysisComparison, AnalysisParameters, AnalysisRequest, BestPracticeModelPort, CallCorpus, IndicatorInfo, ModelMode, SignalInfo } from "./ports.js"
import { runBestPracticeAnalysis } from "./run-analysis.js"

/**
 * PEDIDO e EXECUÇÃO de análises. O pedido é validado aqui (indicador ativo da organização, Grupo no escopo de quem administra,
 * dataset sintético só fora de produção, modelo simulado só com gabarito) e entra na FILA; o processamento (tarefa periódica do
 * worker, com posse e nova tentativa) roda a análise com a organização da análise no contexto de IA (uso e custo registrados).
 */
export const ANALYSIS_LEASE_SECONDS = 20 * 60
export const ANALYSIS_MAX_ATTEMPTS = 2
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência no formato AAAA-MM.")

export const createAnalysisSchema = z.object({
  origin: z.enum(["REAL", "SYNTHETIC"]),
  syntheticDatasetId: z.string().uuid().nullish(),
  /** Medir por: o indicador (melhores = 1º quartil oficial) ou o sinal da chamada (chamadas boas × ruins, `BEST_PRACTICE_ANALYSIS_V3`). */
  outcomeSource: z.enum(["INDICATOR", "CALL_SIGNAL"]).default("INDICATOR"),
  indicatorDefinitionId: z.string().uuid().nullish(),
  channelFlagId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  /** Opcional: compara só os operadores deste Subgrupo do Grupo (`BEST_PRACTICE_ANALYSIS_V2`). */
  subteamId: z.string().uuid().nullish(),
  referencePeriods: z.array(period).min(1).max(6),
  contextLevel: z.enum(["REASON", "SUB_REASON"]).default("SUB_REASON"),
  channel: z.string().trim().min(1).max(40).nullish(),
  comparison: z.enum(COMPARISON_MODES as unknown as [string, ...string[]]).default("TOP_QUARTILE_VS_REST"),
  modelMode: z.enum(["REAL", "SIMULATED_ANSWER_KEY"]).default("REAL"),
  parameters: z
    .object({
      minCallsPerOperator: z.number().int().min(SAMPLING_FLOORS.minCallsPerOperator).max(10).optional(),
      minOperatorsPerGroup: z.number().int().min(SAMPLING_FLOORS.minOperatorsPerGroup).max(30).optional(),
      maxCallsPerOperator: z.number().int().min(2).max(8).optional(),
      maxCallsPerAnalysis: z.number().int().min(20).max(400).optional(),
      maxModelCalls: z.number().int().min(5).max(200).optional(),
      hypotheses: z.array(z.string().trim().min(5).max(200)).max(10).optional(),
    })
    .default({}),
})

export type AnalysisActor = { organizationId: string; personId: string; accountId: string }
export const isProductionEnvironment = () => process.env.NODE_ENV === "production"

async function audit(db: Pick<Database, "query">, actor: Pick<AnalysisActor, "organizationId" | "personId">, action: string, entityId: string, payload: Record<string, unknown>) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'best_practice', $4, $5)`, [actor.organizationId, actor.personId, action, entityId, JSON.stringify(payload)])
}

export async function createAnalysis(db: Database, actor: AnalysisActor, scopes: ManageableScopes, body: unknown): Promise<{ id: string; status: string }> {
  const input = createAnalysisSchema.parse(body)
  let indicatorId: string | null = null
  let flagId: string | null = null
  let callOutcome: unknown = null
  if (input.outcomeSource === "CALL_SIGNAL") {
    const flag = (await db.query<{ id: string; active: boolean; call_outcome: unknown }>(`select id, active, call_outcome from channel_flags where id = $1 and organization_id = $2`, [input.channelFlagId ?? null, actor.organizationId])).rows[0]
    if (!flag) throw new DomainError("Sinal da chamada não encontrado.", "BEST_PRACTICE_SIGNAL_NOT_FOUND", 422)
    if (!flag.active) throw new DomainError("O sinal está desativado.", "BEST_PRACTICE_SIGNAL_INACTIVE", 422)
    const parsed = callOutcomeSchema.safeParse(flag.call_outcome)
    if (!parsed.success) throw new DomainError("Cadastre no sinal o que é chamada boa e ruim antes de analisar por ele.", "BEST_PRACTICE_SIGNAL_NOT_CONFIGURED", 422)
    flagId = flag.id
    callOutcome = parsed.data
  } else {
    const indicator = (await db.query<{ id: string; active: boolean }>(`select id, active from indicator_definitions where id = $1 and organization_id = $2`, [input.indicatorDefinitionId ?? null, actor.organizationId])).rows[0]
    if (!indicator) throw new DomainError("Indicador não encontrado.", "BEST_PRACTICE_INDICATOR_NOT_FOUND", 422)
    if (!indicator.active) throw new DomainError("O indicador está desativado.", "BEST_PRACTICE_INDICATOR_INACTIVE", 422)
    indicatorId = indicator.id
  }
  const comparison: AnalysisComparison = flagId ? "GOOD_VS_BAD_CALLS" : (input.comparison as AnalysisComparison)
  let teamId: string | null = null
  let subteamId: string | null = null
  let datasetId: string | null = null
  if (input.origin === "REAL") {
    if (!input.teamId) throw new DomainError("Escolha o Grupo (operação) da análise.", "BEST_PRACTICE_TEAM_REQUIRED", 422)
    if (input.modelMode !== "REAL") throw new DomainError("O modelo simulado só existe para o dataset sintético.", "BEST_PRACTICE_SIMULATION_ONLY_SYNTHETIC", 422)
    const team = (await db.query(`select 1 from teams where id = $1 and organization_id = $2`, [input.teamId, actor.organizationId])).rowCount
    if (!team) throw new DomainError("Grupo não encontrado.", "BEST_PRACTICE_TEAM_NOT_FOUND", 422)
    if (input.subteamId) {
      const subteam = (await db.query(`select 1 from subteams where id = $1 and team_id = $2 and organization_id = $3`, [input.subteamId, input.teamId, actor.organizationId])).rowCount
      if (!subteam) throw new DomainError("Subgrupo não encontrado neste Grupo.", "BEST_PRACTICE_SUBTEAM_NOT_FOUND", 422)
      if (!canManageScope(scopes, { scopeType: "SUBTEAM", teamId: input.teamId, subteamId: input.subteamId })) throw new DomainError("Você não administra este Subgrupo.", "BEST_PRACTICE_SCOPE_DENIED", 403)
      subteamId = input.subteamId
    } else if (!canManageScope(scopes, { scopeType: "TEAM", teamId: input.teamId, subteamId: null })) throw new DomainError("Você não administra este Grupo.", "BEST_PRACTICE_SCOPE_DENIED", 403)
    teamId = input.teamId
  } else {
    if (input.subteamId) throw new DomainError("O dataset sintético não tem Subgrupo.", "BEST_PRACTICE_SUBTEAM_ONLY_REAL", 422)
    if (isProductionEnvironment()) throw new DomainError("Dados sintéticos não são analisados em produção.", "BEST_PRACTICE_SYNTHETIC_DISABLED", 403)
    if (!coversOrganization(scopes)) throw new DomainError("Só quem administra a organização inteira roda o dataset sintético.", "BEST_PRACTICE_SCOPE_DENIED", 403)
    const dataset = (await db.query<{ id: string; has_truth: boolean }>(`select id, answer_key is not null has_truth from best_practice_synthetic_datasets where id = $1 and organization_id = $2`, [input.syntheticDatasetId ?? null, actor.organizationId])).rows[0]
    if (!dataset) throw new DomainError("Dataset sintético não encontrado.", "BEST_PRACTICE_DATASET_NOT_FOUND", 422)
    if (input.modelMode === "SIMULATED_ANSWER_KEY" && !dataset.has_truth) throw new DomainError("Este dataset não tem gabarito para o modelo simulado.", "BEST_PRACTICE_ANSWER_KEY_MISSING", 422)
    datasetId = dataset.id
  }
  const running = (await db.query(
    `select 1 from best_practice_analyses where organization_id = $1 and status in ('QUEUED', 'RUNNING') and data_origin = $2 and synthetic_dataset_id is not distinct from $3 and indicator_definition_id is not distinct from $4 and channel_flag_id is not distinct from $7 and team_id is not distinct from $5 and subteam_id is not distinct from $6`,
    [actor.organizationId, input.origin, datasetId, indicatorId, teamId, subteamId, flagId],
  )).rowCount
  if (running) throw new DomainError("Já existe uma análise deste resultado e população na fila ou em andamento.", "BEST_PRACTICE_ANALYSIS_IN_PROGRESS", 409)
  const parameters: AnalysisParameters = { ...DEFAULT_SAMPLING, maxModelCalls: 80, hypotheses: [], ...Object.fromEntries(Object.entries(input.parameters).filter(([, value]) => value !== undefined)) }
  const row = (await db.query<{ id: string; status: string }>(
    `insert into best_practice_analyses (organization_id, data_origin, synthetic_dataset_id, indicator_definition_id, team_id, subteam_id, reference_periods, context_level, channel, comparison, model_mode, parameters, logic_version, status, requested_by_person_id, requested_by_account_id, channel_flag_id, call_outcome)
     values ($1, $2, $3, $4, $5, $15, $6, $7, $8, $9, $10, $11, $12, 'QUEUED', $13, $14, $16, $17) returning id, status`,
    [actor.organizationId, input.origin, datasetId, indicatorId, teamId, [...new Set(input.referencePeriods)].sort(), input.contextLevel, input.channel ?? null, comparison, input.modelMode, JSON.stringify(parameters), BEST_PRACTICE_ANALYSIS_LOGIC_VERSION, actor.personId, actor.accountId, subteamId, flagId, callOutcome ? JSON.stringify(callOutcome) : null],
  )).rows[0]!
  await audit(db, actor, "BEST_PRACTICE_ANALYSIS_REQUESTED", row.id, { origin: input.origin, indicatorDefinitionId: indicatorId, channelFlagId: flagId, teamId, subteamId, syntheticDatasetId: datasetId, referencePeriods: input.referencePeriods, modelMode: input.modelMode })
  return row
}

type ClaimedAnalysis = { id: string; organization_id: string; data_origin: "REAL" | "SYNTHETIC"; synthetic_dataset_id: string | null; indicator_definition_id: string | null; channel_flag_id: string | null; call_outcome: unknown; team_id: string | null; subteam_id: string | null; reference_periods: string[]; context_level: "REASON" | "SUB_REASON"; channel: string | null; comparison: AnalysisRequest["comparison"]; model_mode: ModelMode; parameters: AnalysisParameters; attempts: number; requested_by_person_id: string | null }

export async function claimAnalyses(db: Database, limit: number): Promise<ClaimedAnalysis[]> {
  return (await db.query<ClaimedAnalysis>(
    `with picked as (
       select id from best_practice_analyses
        where (status = 'QUEUED' and next_attempt_at <= now()) or (status = 'RUNNING' and claimed_until < now())
        order by next_attempt_at limit $1 for update skip locked
     )
     update best_practice_analyses a set status = 'RUNNING', attempts = a.attempts + 1, claimed_until = now() + make_interval(secs => $2), started_at = coalesce(a.started_at, now())
       from picked where a.id = picked.id
     returning a.id, a.organization_id, a.data_origin, a.synthetic_dataset_id, a.indicator_definition_id, a.channel_flag_id, a.call_outcome, a.team_id, a.subteam_id, a.reference_periods, a.context_level, a.channel, a.comparison, a.model_mode, a.parameters, a.attempts, a.requested_by_person_id`,
    [limit, ANALYSIS_LEASE_SECONDS],
  )).rows
}

export type AnalysisRuntime = { model?: (analysis: ClaimedAnalysis) => BestPracticeModelPort | null }

async function dependenciesOf(db: Database, analysis: ClaimedAnalysis, runtime: AnalysisRuntime): Promise<{ indicator: IndicatorInfo | null; signal: SignalInfo | null; corpus: CallCorpus; model: BestPracticeModelPort }> {
  let info: IndicatorInfo | null = null
  let signal: SignalInfo | null = null
  if (analysis.channel_flag_id) {
    const flag = (await db.query<{ id: string; flag_name: string; label: string | null }>(`select id, flag_name, label from channel_flags where id = $1 and organization_id = $2`, [analysis.channel_flag_id, analysis.organization_id])).rows[0]
    if (!flag) throw new DomainError("Sinal da análise não existe mais.", "BEST_PRACTICE_SIGNAL_NOT_FOUND", 422)
    signal = { id: flag.id, flagName: flag.flag_name, name: flag.label?.trim() || flag.flag_name, outcome: callOutcomeSchema.parse(analysis.call_outcome) }
  } else {
    const indicator = (await db.query<{ id: string; code: string; name: string; unit: string; desired_direction: IndicatorInfo["direction"] }>(`select id, code, name, unit, desired_direction from indicator_definitions where id = $1 and organization_id = $2`, [analysis.indicator_definition_id, analysis.organization_id])).rows[0]
    if (!indicator) throw new DomainError("Indicador da análise não existe mais.", "BEST_PRACTICE_INDICATOR_NOT_FOUND", 422)
    info = { id: indicator.id, code: indicator.code, name: indicator.name, unit: indicator.unit, direction: indicator.desired_direction }
  }
  const injected = runtime.model?.(analysis) ?? null
  if (analysis.data_origin === "REAL") {
    const team = (await db.query<{ name: string }>(`select name from teams where id = $1 and organization_id = $2`, [analysis.team_id, analysis.organization_id])).rows[0]
    if (!team) throw new DomainError("Grupo da análise não existe mais.", "BEST_PRACTICE_TEAM_NOT_FOUND", 422)
    const subteam = analysis.subteam_id ? (await db.query<{ name: string }>(`select name from subteams where id = $1 and organization_id = $2`, [analysis.subteam_id, analysis.organization_id])).rows[0] : null
    if (analysis.subteam_id && !subteam) throw new DomainError("Subgrupo da análise não existe mais.", "BEST_PRACTICE_SUBTEAM_NOT_FOUND", 422)
    return { indicator: info, signal, corpus: createRealCallCorpus(db, { organizationId: analysis.organization_id, teamId: analysis.team_id!, teamName: team.name, subteamId: analysis.subteam_id, subteamName: subteam?.name ?? null }), model: injected ?? createGatewayBestPracticeModel() }
  }
  if (isProductionEnvironment()) throw new DomainError("Dados sintéticos não são analisados em produção.", "BEST_PRACTICE_SYNTHETIC_DISABLED", 403)
  const dataset = (await db.query<{ label: string; corpus: unknown; answer_key: unknown }>(`select label, corpus, answer_key from best_practice_synthetic_datasets where id = $1 and organization_id = $2`, [analysis.synthetic_dataset_id, analysis.organization_id])).rows[0]
  if (!dataset) throw new DomainError("Dataset sintético não existe mais.", "BEST_PRACTICE_DATASET_NOT_FOUND", 422)
  const corpus = syntheticCorpusSchema.parse(dataset.corpus)
  const model = analysis.model_mode === "SIMULATED_ANSWER_KEY" ? createSimulatedAnswerKeyModel(corpus, syntheticAnswerKeySchema.parse(dataset.answer_key)) : injected ?? createGatewayBestPracticeModel()
  return { indicator: info, signal, corpus: createSyntheticCallCorpus(corpus, { indicatorCode: info?.code ?? "", datasetLabel: dataset.label }), model }
}

export async function processAnalysis(db: Database, analysis: ClaimedAnalysis, runtime: AnalysisRuntime = {}): Promise<"COMPLETED" | "RETRY" | "FAILED"> {
  try {
    const deps = await dependenciesOf(db, analysis, runtime)
    const request: AnalysisRequest = { id: analysis.id, organizationId: analysis.organization_id, origin: analysis.data_origin, syntheticDatasetId: analysis.synthetic_dataset_id, indicatorDefinitionId: analysis.indicator_definition_id, channelFlagId: analysis.channel_flag_id, callOutcome: analysis.channel_flag_id ? callOutcomeSchema.parse(analysis.call_outcome) : null, teamId: analysis.team_id, subteamId: analysis.subteam_id, referencePeriods: analysis.reference_periods, contextLevel: analysis.context_level, channel: analysis.channel, comparison: analysis.comparison, modelMode: analysis.model_mode, parameters: analysis.parameters }
    const result = await runWithAiOrganization(analysis.organization_id, () => runBestPracticeAnalysis({ ...deps, store: createPostgresBestPracticeStore(db), now: () => new Date() }, request), { requesterPersonId: analysis.requested_by_person_id })
    if (!result.completedInStore) {
      await db.query(
        `update best_practice_analyses set status = 'COMPLETED', outcome = $2, report = $3, provenance = $4, finished_at = now(), claimed_until = null where id = $1 and status = 'RUNNING'`,
        [analysis.id, result.report.outcome, JSON.stringify(result.report), JSON.stringify(result.provenance)],
      )
    }
    return "COMPLETED"
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Falha técnica.").slice(0, 500)
    const code = error instanceof DomainError ? error.code : "BEST_PRACTICE_ANALYSIS_FAILED"
    const definitive = error instanceof DomainError || analysis.attempts >= ANALYSIS_MAX_ATTEMPTS
    console.error(JSON.stringify({ event: "best_practice_analysis_failed", analysisId: analysis.id, attempt: analysis.attempts, code, message }))
    if (definitive) await db.query(`update best_practice_analyses set status = 'FAILED', error_code = $2, error_message = $3, finished_at = now(), claimed_until = null where id = $1`, [analysis.id, code, message])
    else await db.query(`update best_practice_analyses set status = 'QUEUED', next_attempt_at = now() + interval '1 minute', error_code = $2, error_message = $3, claimed_until = null where id = $1`, [analysis.id, code, message])
    return definitive ? "FAILED" : "RETRY"
  }
}

/** Tarefa periódica do worker: uma análise por rodada (são longas; a posse de 20 min cobre a execução). */
export async function processBestPracticeAnalyses(db: Database, runtime: AnalysisRuntime = {}, limit = 1): Promise<number> {
  const claimed = await claimAnalyses(db, limit)
  for (const analysis of claimed) await processAnalysis(db, analysis, runtime)
  return claimed.length
}
