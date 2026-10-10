import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { dateParam, listParam, respondList, searchParam, SqlFilter, type PageResult } from "../../../shared/presentation/list-query.js"
import { summarizeLlmCalls } from "../../../shared/application/llm-telemetry.js"
import type { QaTrace, WorkflowSimulationState } from "../domain/qa-run-schema.js"
import { buildQaRunTelemetry, buildToolBudget, collectInvestigations, type QaReferenceRun, type QaRunTelemetry } from "../domain/qa-run-telemetry.js"
import type { DatasetFingerprint } from "../domain/dataset-fingerprint.js"
import { loadDatasetFingerprint } from "./dataset-fingerprint-loader.js"


export type QaRunStatus = "RUNNING" | "COMPLETED" | "WAITING" | "PAUSED" | "FAILED"
export type QaResourceType = "WORKFLOW" | "AGENT" | "ORCHESTRATOR"

export type QaRunRecord = {
  id: string
  executedBy: string
  executedByName: string | null
  resourceType: QaResourceType
  resourceId: string
  resourceName: string
  status: QaRunStatus
  input: Record<string, unknown>
  context: Record<string, unknown>
  state: WorkflowSimulationState | null
  trace: QaTrace
  aiCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  durationMs: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  /** Só na listagem leve: o suficiente pro histórico dizer QUAL interação/colaborador foi testado
   * sem carregar context/trace inteiros (nunca a transcrição — Parte 67). */
  contextSummary?: { operatorName: string | null; interactionId: string | null; interactionExternalId: string | null; interactionStartedAt: string | null; workflowState: string | null } | null
  /** Telemetria de eficiência (V1.1) — na listagem leve vem SEM `perRequest` (drill-down só no detalhe). null = run anterior à telemetria. */
  telemetry?: QaRunTelemetry | null
}

function selectSql(details: boolean) {
  // Listagem leve: trace/context/state ficam de fora (podem ser grandes) — o detalhe vem de getQaRun.
  const heavy = details
    ? `r.context, r.state, r.trace,`
    : `'{}'::jsonb context, null::jsonb state, '{}'::jsonb trace,
       jsonb_build_object('operatorName', r.context->'operator'->>'name', 'interactionId', r.context->'interaction'->>'id',
                          'interactionExternalId', r.context->'interaction'->>'externalId', 'interactionStartedAt', r.context->'interaction'->>'startedAt',
                          'workflowState', r.context->'workflow'->>'workflowState') "contextSummary",
       (r.trace->'telemetry') - 'perRequest' telemetry,`
  return `
  select r.id, r.executed_by "executedBy", p.name "executedByName", r.resource_type "resourceType", r.resource_id "resourceId",
         r.resource_name "resourceName", r.status, r.input, ${heavy} r.ai_calls "aiCalls",
         r.input_tokens "inputTokens", r.output_tokens "outputTokens", r.total_tokens "totalTokens", r.duration_ms "durationMs",
         r.error_message "errorMessage", r.created_at "createdAt", r.updated_at "updatedAt"
  from qa_runs r left join people p on p.id = r.executed_by
  where r.organization_id = $1`
}

export function statusFromState(state: WorkflowSimulationState): QaRunStatus {
  switch (state.status) {
    case "completed":
      return "COMPLETED"
    case "failed":
      return "FAILED"
    case "waiting":
      return "WAITING"
    case "paused":
      return "PAUSED"
    default:
      return "RUNNING"
  }
}

export async function insertQaRun(
  db: Database,
  input: {
    /** Organização de quem executa (sessão do administrador) — o recurso testado é dela. */
    organizationId: string
    executedBy: string
    resourceType: QaResourceType
    resourceId: string
    resourceName: string
    status: QaRunStatus
    input: unknown
    context: Record<string, unknown>
    state: WorkflowSimulationState | null
    trace: QaTrace
    durationMs: number
    errorMessage: string | null
  },
): Promise<string> {
  const totals = summarizeLlmCalls(input.trace.aiCalls)
  const { organizationId } = input
  const reference = await findReferenceRun(db, { organizationId, resourceType: input.resourceType, resourceId: input.resourceId, context: input.context, before: null })
  // DATASET FINGERPRINT (V1.3.1): assinatura da massa no momento do run — só contagens, nunca conteúdo.
  const datasetFingerprint = input.trace.datasetFingerprint ?? (await loadDatasetFingerprint(db, { organizationId, operatorId: (input.context.operator as { id?: string } | null | undefined)?.id ?? null }))
  const traceWithFingerprint: QaTrace = { ...input.trace, ...(datasetFingerprint ? { datasetFingerprint } : {}) }
  const trace: QaTrace = { ...traceWithFingerprint, telemetry: buildQaRunTelemetry(traceWithFingerprint, reference) }
  const result = await db.query<{ id: string }>(
    `insert into qa_runs(organization_id, executed_by, resource_type, resource_id, resource_name, status, input, context, state, trace,
                         ai_calls, input_tokens, output_tokens, total_tokens, duration_ms, error_message)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [
      organizationId,
      input.executedBy,
      input.resourceType,
      input.resourceId,
      input.resourceName,
      input.status,
      JSON.stringify(input.input),
      JSON.stringify(input.context),
      input.state ? JSON.stringify(input.state) : null,
      JSON.stringify(trace),
      totals.aiCalls,
      totals.inputTokens,
      totals.outputTokens,
      totals.totalTokens,
      input.durationMs,
      input.errorMessage,
    ],
  )
  return result.rows[0]!.id
}

/**
 * Run de REFERÊNCIA compatível: mesmo recurso (tipo + id) e mesmo colaborador/interação testados
 * (contexto), o mais recente anterior. Runs antigos sem telemetria valem como referência com o
 * que têm (colunas de totais); Tool calls ficam "não informado".
 */
export async function findReferenceRun(
  db: Database,
  input: { organizationId: string; resourceType: QaResourceType; resourceId: string; context: Record<string, unknown>; before: { id: string; createdAt: string } | null },
): Promise<QaReferenceRun | null> {
  const { organizationId } = input
  const operatorId = (input.context.operator as { id?: string } | null | undefined)?.id ?? null
  const interactionId = (input.context.interaction as { id?: string } | null | undefined)?.id ?? null
  const result = await db.query<{ id: string; created_at: string; ai_calls: number; input_tokens: number; output_tokens: number; total_tokens: number; duration_ms: number; telemetry: QaRunTelemetry | null; fingerprint_hash: string | null; fingerprint_dataset: { version: string; fingerprint: string } | null; legacy_steps: Pick<QaTrace, "steps" | "employeeRuns"> | null }>(
    `select r.id, r.created_at, r.ai_calls, r.input_tokens, r.output_tokens, r.total_tokens, r.duration_ms, (r.trace->'telemetry') - 'perRequest' telemetry, r.trace->'datasetFingerprint'->>'hash' fingerprint_hash,
            r.trace->'datasetFingerprint'->'components'->'dataset' fingerprint_dataset,
            case when r.trace ? 'telemetry' then null else jsonb_build_object('steps', coalesce(r.trace->'steps', '[]'::jsonb), 'employeeRuns', coalesce(r.trace->'employeeRuns', '[]'::jsonb)) end legacy_steps
     from qa_runs r
     where r.organization_id = $1 and r.resource_type = $2 and r.resource_id = $3
       and (r.context->'operator'->>'id') is not distinct from $4
       and (r.context->'interaction'->>'id') is not distinct from $5
       and ($6::uuid is null or (r.id <> $6 and r.created_at < $7::timestamptz))
       and r.status not in ('RUNNING', 'FAILED')
     order by r.created_at desc limit 1`,
    [organizationId, input.resourceType, input.resourceId, operatorId, interactionId, input.before?.id ?? null, input.before?.createdAt ?? null],
  )
  const row = result.rows[0]
  if (!row) return null
  // Run anterior à telemetria: as Tool calls ainda podem ser contadas do trace persistido dos steps (fato observável).
  const legacyBudget = row.legacy_steps ? (() => { const collected = collectInvestigations(row.legacy_steps); return buildToolBudget(collected.toolTraces, collected.summaries) })() : null
  return {
    runId: row.id,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(row.created_at).toISOString(),
    requests: row.ai_calls,
    toolCalls: row.telemetry?.toolBudget ? row.telemetry.toolBudget.executed : (legacyBudget?.executed ?? null),
    tokens: { input: row.input_tokens, output: row.output_tokens, total: row.total_tokens, cached: row.telemetry?.tokens.cached ?? null },
    durationMs: row.duration_ms,
    staticPromptChars: row.telemetry?.contextBreakdown?.staticPromptChars ?? null,
    toolSchemaChars: row.telemetry?.contextBreakdown?.toolSchemaChars ?? null,
    cost: row.telemetry?.cost?.total ?? null,
    datasetFingerprint: row.fingerprint_hash ? { hash: row.fingerprint_hash, dataset: row.fingerprint_dataset ?? null } : null,
    planningRounds: row.telemetry?.toolBudget?.planningRounds ?? null,
  }
}

export async function updateQaRun(
  db: Database,
  organizationId: string,
  id: string,
  input: { status: QaRunStatus; state: WorkflowSimulationState | null; trace: QaTrace; durationMs: number; errorMessage: string | null },
): Promise<void> {
  const totals = summarizeLlmCalls(input.trace.aiCalls)
  // A referência (run anterior compatível) é preservada da inserção; só os números deste run mudam.
  const stored = await db.query<{ reference: QaReferenceRun | null; fingerprint: DatasetFingerprint | null }>(`select r.trace->'telemetry'->'reference' reference, r.trace->'datasetFingerprint' fingerprint from qa_runs r where r.id = $1 and r.organization_id = $2`, [id, organizationId])
  // O fingerprint é do INÍCIO do run (a massa de então) — preservado a cada update.
  const datasetFingerprint = input.trace.datasetFingerprint ?? stored.rows[0]?.fingerprint ?? null
  const traceWithFingerprint: QaTrace = { ...input.trace, ...(datasetFingerprint ? { datasetFingerprint } : {}) }
  const trace: QaTrace = { ...traceWithFingerprint, telemetry: buildQaRunTelemetry(traceWithFingerprint, input.trace.telemetry?.reference ?? stored.rows[0]?.reference ?? null) }
  await db.query(
    `update qa_runs set status = $2, state = $3, trace = $4, ai_calls = $5, input_tokens = $6, output_tokens = $7, total_tokens = $8,
                        duration_ms = duration_ms + $9, error_message = $10, updated_at = now()
     where id = $1 and organization_id = $11`,
    [id, input.status, input.state ? JSON.stringify(input.state) : null, JSON.stringify(trace), totals.aiCalls, totals.inputTokens, totals.outputTokens, totals.totalTokens, input.durationMs, input.errorMessage, organizationId],
  )
}

export async function getQaRun(db: Database, organizationId: string, id: string): Promise<QaRunRecord | null> {
  const result = await db.query<QaRunRecord>(`${selectSql(true)} and r.id = $2`, [organizationId, id])
  return result.rows[0] ?? null
}

/** Filtros do Histórico de QA (mesmo padrão das listagens administrativas — list-query.ts). */
export const listQaRunsSchema = z.object({
  search: searchParam,
  resourceType: listParam(z.enum(["WORKFLOW", "AGENT", "ORCHESTRATOR"])),
  status: listParam(z.enum(["RUNNING", "COMPLETED", "WAITING", "PAUSED", "FAILED"])),
  // Configuração testada (só Workflow): DRAFT | PUBLISHED, gravada em input.graphSource.
  workflowState: listParam(z.enum(["DRAFT", "PUBLISHED"])),
  executedBy: z.string().uuid().optional(),
  createdFrom: dateParam,
  createdTo: dateParam,
})
export type ListQaRunsInput = z.infer<typeof listQaRunsSchema>

/** Histórico de QA: sem page/pageSize devolve o array (compatibilidade), com eles o envelope
 * paginado. Busca cobre recurso, administrador, colaborador e protocolo da interação testada. */
export async function listQaRuns(db: Database, organizationId: string, query: Record<string, unknown>, input: ListQaRunsInput): Promise<QaRunRecord[] | PageResult<QaRunRecord>> {
  const filter = new SqlFilter([organizationId])
    .search(input.search, ['q."resourceName"', 'q."executedByName"', `q."contextSummary"->>'operatorName'`, `q."contextSummary"->>'interactionExternalId'`])
    .in('q."resourceType"', input.resourceType)
    .in("q.status", input.status)
    .in(`q.input->>'graphSource'`, input.workflowState)
    .equals('q."executedBy"', input.executedBy)
    .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
  return respondList<QaRunRecord>(db, query, { select: selectSql(false), filter, orderBy: 'q."createdAt" desc' })
}
