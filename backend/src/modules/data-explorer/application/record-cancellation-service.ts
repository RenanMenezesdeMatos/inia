import { createHash } from "node:crypto"
import type pg from "pg"
import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import type { ExplorerCancellation, ExplorerDataset } from "../domain/explorer-catalog-types.js"
import { compileCancellationScope } from "../domain/explorer-compiler.js"
import { explorerErrors } from "../domain/explorer-errors.js"
import { filterColumnsOf, IDENTIFIER, resolveExplorerQuery, UUID, type ExplorerQuery } from "../domain/explorer-query.js"
import { REACTIVATION_PROBLEMS, reactivationProblem, type IndicatorRuleSnapshot, type ReactivationIndicator, type ReactivationProblem } from "../domain/record-reactivation.js"
import { recordExplorerAudit } from "./explorer-audit.js"
import { knownDataset, requireDataset, type ExplorerActor, type ExplorerDeps } from "./explorer-service.js"
import { EXPLORER_LOCK_NAMESPACE, toExplorerError, withExplorerSession } from "./read-only-session.js"

const log = createLogger("data-explorer")

/**
 * CANCELAMENTO DE REGISTROS. O registro continua no banco e sai da lógica: as tabelas têm `cancelled_at`, e o nome sem sufixo é uma visão que esconde o cancelado (migration 174).
 * É a única escrita de dado de negócio neste módulo, e não usa a sessão da consulta, que continua somente leitura. Regras:
 *  - nunca vale para o conjunto inteiro: exige registros marcados ou um filtro;
 *  - a prévia e a confirmação usam a mesma função de alcance, e a confirmação trava as linhas e recusa se os registros mudaram (impressão digital dos ids, não só a quantidade);
 *  - recusa com execução de Workflow rodando ou com carga do mesmo tipo em andamento, e recusa os resultados de quem está cancelando (ou reativando);
 *  - tudo numa transação, com o registro na auditoria: sem auditoria, nada é cancelado.
 * O motivo foi escrito à mão, então fica só no lote (`data_record_cancellations`), nunca na auditoria nem em log.
 */
/**
 * Só o que o motor ainda vai rodar sozinho: `active` ou `waiting` em Workflow ativo. Execução `blocked` ou de Workflow pausado não barra, porque pode nunca sair daí (uma nova tentativa
 * cria outra execução, e a original fica bloqueada para sempre), e barrar seria um beco sem saída. Se ela voltar a rodar, o motor a bloqueia antes de qualquer etapa (`engine.ts`).
 */
const RUNNING_EXECUTION_STATUSES = ["active", "waiting"]
const OPEN_EXECUTION_STATUSES = ["active", "waiting", "blocked"]
const ACTIVE_RUN_STATUSES = ["QUEUED", "CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING"]
const LIST_LIMIT = 50

const scopeShape = {
  dataset: z.string().regex(IDENTIFIER),
  filter: z.unknown().optional(),
  search: z.string().max(1_000).optional(),
  keys: z.array(z.string().regex(UUID)).min(1).max(1_000).optional(),
}
const scopeSchema = z.object(scopeShape).strict()
const cancelSchema = z.object({ ...scopeShape, reason: z.string().max(2_000), expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
const reactivateSchema = z.object({ expectedRows: z.number().int().positive() }).strict()

type Scope = { dataset: ExplorerDataset; cancellation: ExplorerCancellation; query: ExplorerQuery; keys: string[] | null }

function resolveScope(input: z.infer<typeof scopeSchema>, actor: ExplorerActor, deps: ExplorerDeps): Scope {
  const dataset = requireDataset(input.dataset, actor.access)
  const { cancellation } = dataset
  if (!cancellation) throw explorerErrors.cancelNotAvailable()
  if (input.keys && (input.filter !== undefined || input.search !== undefined)) throw explorerErrors.invalidRequest()
  if (input.keys && input.keys.length > deps.limits.cancelMaxKeys) throw explorerErrors.cancelTooManyKeys(deps.limits.cancelMaxKeys)
  const query = resolveExplorerQuery({ dataset: input.dataset, filter: input.filter, search: input.search }, dataset, deps.limits)
  if (!input.keys && query.conditionCount === 0 && query.search === null) throw explorerErrors.cancelScopeRequired()
  return { dataset, cancellation, query, keys: input.keys ? [...new Set(input.keys.map((key) => key.toLowerCase()))] : null }
}

const parseScope = (raw: unknown) => {
  const parsed = scopeSchema.safeParse(raw)
  if (!parsed.success) throw explorerErrors.invalidRequest()
  return parsed.data
}

/** Controle, formatação e inversão de direção: um motivo não pode ser invisível nem enganar quem lê. */
const INVISIBLE_IN_REASON = /[\p{Cc}\p{Cf}\u2028\u2029]/u

/** Conta caracteres como o banco conta: um emoji é um só, não dois. Quebra de linha é aceita. O motivo nunca volta em mensagem de erro. */
function parseReason(raw: string): string {
  const reason = raw.trim()
  const length = [...reason].length
  if (length < 10 || length > 500 || INVISIBLE_IN_REASON.test(reason.replace(/\r?\n/g, " "))) throw explorerErrors.cancelInvalidReason()
  return reason
}

/** O que a pessoa viu na prévia. A quantidade não basta: um registro pode sair e outro entrar, e o novo seria cancelado sem ela ter visto. */
const scopeFingerprint = (ids: readonly string[]) => createHash("sha256").update([...ids].sort().join(",")).digest("hex")

/** Registros que a pessoa quer cancelar (pelos ids) ou reativar (os que ainda estão presos ao lote). */
type RecordSet = { ids: readonly string[] } | { cancellationId: string }

async function includesOwnRecords(client: pg.ClientBase, cancellation: ExplorerCancellation, personId: string | null, organizationId: string, records: RecordSet): Promise<boolean> {
  if (!personId) return false
  const [match, value] = "ids" in records ? ["r.id = any($3::uuid[])", records.ids] : ["r.cancellation_id = $3::uuid", records.cancellationId]
  const result = await client.query(`select 1 from ${cancellation.table} r where ${cancellation.ownerSql} and r.organization_id = $2 and ${match} limit 1`, [personId, organizationId, value])
  return (result.rowCount ?? 0) > 0
}

async function selectScopeIds(client: pg.ClientBase, scope: Scope, input: { organizationId: string; timeZone: string; cap: number; lock: boolean }): Promise<string[]> {
  const compiled = compileCancellationScope(scope.query, { ...input, keys: scope.keys })
  return (await client.query<{ id: string }>(compiled.sql, compiled.params)).rows.map((row) => row.id)
}

async function hasRunInProgress(client: pg.ClientBase, organizationId: string, contractKey: string): Promise<boolean> {
  const result = await client.query(`select 1 from data_ingestion_runs where organization_id = $1 and contract_key = $2 and status = any($3::text[]) limit 1`, [organizationId, contractKey, ACTIVE_RUN_STATUSES])
  return (result.rowCount ?? 0) > 0
}

async function countRunningExecutions(client: pg.ClientBase, organizationId: string, ids: readonly string[]): Promise<number> {
  const result = await client.query<{ total: number }>(
    `select count(*)::int total from workflow_enrollments e join workflows_all w on w.id = e.workflow_id and w.organization_id = e.organization_id and w.active
      where e.organization_id = $1 and e.indicator_measurement_id = any($2::uuid[]) and e.status = any($3::text[])`,
    [organizationId, ids, RUNNING_EXECUTION_STATUSES],
  )
  return result.rows[0]?.total ?? 0
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : `${count.toLocaleString("pt-BR")} ${many}`
}

export async function previewCancellation(deps: ExplorerDeps, actor: ExplorerActor, raw: unknown) {
  const startedAt = (deps.now ?? Date.now)()
  try {
    const scope = resolveScope(parseScope(raw), actor, deps)
    const { cancellation, query } = scope
    const { organizationId } = actor
    const timeZone = await resolveOrganizationTimezone(deps.db, organizationId)
    const cap = deps.limits.cancelMaxRows
    const facts = await withExplorerSession(deps.db, { kind: "QUERY", organizationId, accountId: actor.accountId, limits: deps.limits }, async (client) => {
      const ids = await selectScopeIds(client, scope, { organizationId, timeZone, cap, lock: false })
      const runInProgress = await hasRunInProgress(client, organizationId, cancellation.contractKey)
      const empty = { executions: 0, runningExecutions: 0, stoppedExecutions: 0, evidences: 0, feedbacks: 0, workflowsOnReload: 0, wholeDataset: false, ownRecords: false, fingerprint: null as string | null }
      if (ids.length === 0 || ids.length > cap) return { rows: ids.length, runInProgress, ...empty }
      const linked = { ...empty, fingerprint: scopeFingerprint(ids), ownRecords: await includesOwnRecords(client, cancellation, actor.personId, organizationId, { ids }) }
      // O filtro pode alcançar tudo de propósito, e a pessoa precisa saber. Lê no máximo um a mais que o alcance.
      const active = await client.query<{ total: number }>(`select count(*)::int total from (select 1 from ${cancellation.table} where organization_id = $1 and cancelled_at is null limit $2::int) capped`, [organizationId, ids.length + 1])
      linked.wholeDataset = (active.rows[0]?.total ?? 0) <= ids.length
      if (cancellation.tracksExecutions) {
        const executions = await client.query<{ total: number; running: number; open: number }>(
          `select count(*)::int total, (count(*) filter (where e.status = any($3::text[]) and w.active))::int running, (count(*) filter (where e.status = any($4::text[])))::int open
             from workflow_enrollments e join workflows_all w on w.id = e.workflow_id and w.organization_id = e.organization_id
            where e.organization_id = $1 and e.indicator_measurement_id = any($2::uuid[])`,
          [organizationId, ids, RUNNING_EXECUTION_STATUSES, OPEN_EXECUTION_STATUSES],
        )
        linked.executions = executions.rows[0]?.total ?? 0
        linked.runningExecutions = executions.rows[0]?.running ?? 0
        linked.stoppedExecutions = (executions.rows[0]?.open ?? 0) - linked.runningExecutions
        const workflows = await client.query<{ total: number }>(
          `select count(*)::int total from workflows w
            where w.organization_id = $1 and w.active and w.active_version_id is not null and w.trigger_config->>'kind' = 'indicator'
              and w.trigger_config->>'indicatorCode' in (select i.code from indicator_measurements_all m join indicator_definitions i on i.id = m.indicator_definition_id and i.organization_id = m.organization_id where m.organization_id = $1 and m.id = any($2::uuid[]))`,
          [organizationId, ids],
        )
        linked.workflowsOnReload = workflows.rows[0]?.total ?? 0
      }
      if (cancellation.evidenceSourceTypes.length > 0) {
        // Resumo de período e fechamento citam vários ids no mesmo campo, separados por vírgula: comparar o campo inteiro diria que nada cita o registro.
        const evidence = await client.query<{ evidences: number; feedbacks: number }>(
          `with cited as (select case_id from evidences where organization_id = $1 and source_type = any($2::text[]) and string_to_array(source_id, ',') && $3::text[])
           select (select count(*) from cited)::int evidences, (select count(distinct f.id) from feedbacks f where f.organization_id = $1 and f.case_id in (select case_id from cited))::int feedbacks`,
          [organizationId, cancellation.evidenceSourceTypes, ids],
        )
        linked.evidences = evidence.rows[0]?.evidences ?? 0
        linked.feedbacks = evidence.rows[0]?.feedbacks ?? 0
      }
      return { rows: ids.length, runInProgress, ...linked }
    })
    const capped = facts.rows > cap
    const blockers: { code: string; message: string }[] = []
    const refuse = (error: DomainError) => blockers.push({ code: error.code, message: error.message })
    if (facts.rows === 0) refuse(explorerErrors.cancelNothing())
    if (capped) refuse(explorerErrors.cancelTooMany(cap))
    if (facts.runningExecutions > 0) refuse(explorerErrors.cancelInFlight(facts.runningExecutions))
    if (facts.runInProgress) refuse(explorerErrors.cancelRunInProgress())
    if (facts.ownRecords) refuse(explorerErrors.cancelOwnRecords())
    const notices = [
      "Os registros continuam guardados e saem dos cálculos. Os painéis se atualizam em alguns minutos.",
      "Se a origem enviar o mesmo registro de novo, ele volta a valer.",
      ...(facts.wholeDataset ? ["Este alcance inclui todos os registros ativos deste conjunto."] : []),
      ...(cancellation.affectsOfficialResult ? ["A PRV não é recalculada: ela vem fechada da origem."] : []),
      ...(cancellation.tracksExecutions ? [] : ["Execuções de Workflow em andamento passam a ler os dados sem estes registros, como numa carga."]),
      ...(facts.executions > 0 ? [`${plural(facts.executions, "Uma execução de Workflow usou", "execuções de Workflow usaram")} estes registros. O histórico continua disponível.`] : []),
      ...(facts.stoppedExecutions > 0 ? [`${plural(facts.stoppedExecutions, "Uma execução parada usa", "execuções paradas usam")} estes registros. Se voltar a rodar, ela fica bloqueada até o registro voltar a valer.`] : []),
      ...(facts.feedbacks > 0 ? [`${plural(facts.feedbacks, "Um feedback cita", "feedbacks citam")} estes registros como evidência. Feedback já entregue não é alterado.`] : []),
      ...(facts.workflowsOnReload > 0 ? [`Se estes registros forem carregados de novo, ${plural(facts.workflowsOnReload, "um Workflow ativo roda", "Workflows ativos rodam")} outra vez, e isso pode gastar IA.`] : []),
    ]
    const durationMs = (deps.now ?? Date.now)() - startedAt
    await recordExplorerAudit(deps.db, { organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_RECORDS_CANCEL_PREVIEW", result: "OK", dataset: scope.dataset.code, durationMs, rows: capped ? cap : facts.rows, capped, filterColumns: filterColumnsOf(query.filter), filterConditions: query.conditionCount, searched: query.search !== null, byKeys: scope.keys !== null })
    return { rows: capped ? cap : facts.rows, capped, maxRows: cap, scopeFingerprint: facts.fingerprint, executions: facts.executions, runningExecutions: facts.runningExecutions, stoppedExecutions: facts.stoppedExecutions, evidences: facts.evidences, feedbacks: facts.feedbacks, workflowsOnReload: facts.workflowsOnReload, wholeDataset: facts.wholeDataset, blockers, notices, canCancel: blockers.length === 0 }
  } catch (error) {
    const failure = toExplorerError(error, { kind: "QUERY", limits: deps.limits })
    await auditRefusal(deps, actor, "DATA_HUB_RECORDS_CANCEL_PREVIEW", knownDataset(raw), failure, startedAt)
    throw failure
  }
}

function toWriteError(error: unknown): DomainError {
  if (error instanceof DomainError) return error
  const code = (error as { code?: unknown }).code
  if (code === "57014") return explorerErrors.cancelTimeout()
  if (code === "55P03") return explorerErrors.cancelLocked()
  if (code === "22007" || code === "22008" || code === "22003" || code === "22P02") return explorerErrors.invalidValue()
  log.error({ code: typeof code === "string" ? code : null }, "falha ao cancelar ou reativar registros")
  return explorerErrors.cancelFailed()
}

async function auditRefusal(deps: ExplorerDeps, actor: ExplorerActor, action: "DATA_HUB_RECORDS_CANCEL_PREVIEW" | "DATA_HUB_RECORDS_CANCELLED" | "DATA_HUB_RECORDS_REACTIVATED" | "DATA_HUB_RECORDS_REACTIVATION_PREVIEW", dataset: string | null, failure: DomainError, startedAt: number): Promise<void> {
  try {
    await recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action, result: failure.statusCode >= 500 ? "FAILED" : "REJECTED", dataset, durationMs: (deps.now ?? Date.now)() - startedAt, errorCode: failure.code })
  } catch {
    log.error({ action, errorCode: failure.code }, "não foi possível registrar a recusa na auditoria")
  }
}

/** Escrita com limite próprio e uma por organização de cada vez, somando todas as APIs. A trava é de transação: some sozinha se o processo cair. */
async function withWriteTransaction<T>(deps: ExplorerDeps, organizationId: string, work: (client: pg.ClientBase) => Promise<T>): Promise<T> {
  const client = await deps.db.connect()
  let broken = false
  try {
    await client.query("begin")
    await client.query(`select set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true), set_config('TimeZone', 'UTC', true), set_config('DateStyle', 'ISO, YMD', true)`, [String(deps.limits.cancelTimeoutMs), String(deps.limits.cancelLockTimeoutMs), String(deps.limits.cancelTimeoutMs)])
    const slot = await client.query<{ ok: boolean }>(`select pg_try_advisory_xact_lock($1::int, hashtext($2)) ok`, [EXPLORER_LOCK_NAMESPACE, `explorer-cancel:${organizationId}`])
    if (!slot.rows[0]?.ok) throw explorerErrors.cancelBusy()
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => {
      broken = true
    })
    throw error
  } finally {
    client.release(broken)
  }
}

async function snapshotIndicatorRules(client: pg.ClientBase, organizationId: string, cancellation: ExplorerCancellation, ids: readonly string[]): Promise<IndicatorRuleSnapshot> {
  if (cancellation.rule === "NONE") return {}
  const result = await client.query<{ id: string; code: string; unit: string; direction: string; aggregation: string }>(
    `select distinct i.id, i.code, i.unit, i.desired_direction direction, i.operational_aggregation aggregation from ${cancellation.table} r join indicator_definitions i on i.id = r.indicator_definition_id and i.organization_id = r.organization_id where r.organization_id = $1 and r.id = any($2::uuid[])`,
    [organizationId, ids],
  )
  return Object.fromEntries(result.rows.map((row) => [row.id, { code: row.code, unit: row.unit, direction: row.direction, aggregation: row.aggregation }]))
}

export async function executeCancellation(deps: ExplorerDeps, actor: ExplorerActor, raw: unknown) {
  const startedAt = (deps.now ?? Date.now)()
  try {
    const parsed = cancelSchema.safeParse(raw)
    if (!parsed.success) throw explorerErrors.invalidRequest()
    const { reason: rawReason, expectedFingerprint, ...scopeInput } = parsed.data
    const scope = resolveScope(scopeInput, actor, deps)
    const reason = parseReason(rawReason)
    const { dataset, cancellation, query } = scope
    const { organizationId } = actor
    const timeZone = await resolveOrganizationTimezone(deps.db, organizationId)
    const cap = deps.limits.cancelMaxRows
    return await withWriteTransaction(deps, organizationId, async (client) => {
      if (await hasRunInProgress(client, organizationId, cancellation.contractKey)) throw explorerErrors.cancelRunInProgress()
      const ids = await selectScopeIds(client, scope, { organizationId, timeZone, cap, lock: true })
      if (ids.length === 0) throw explorerErrors.cancelNothing()
      if (ids.length > cap) throw explorerErrors.cancelTooMany(cap)
      if (scopeFingerprint(ids) !== expectedFingerprint) throw explorerErrors.cancelScopeChanged()
      if (await includesOwnRecords(client, cancellation, actor.personId, organizationId, { ids })) throw explorerErrors.cancelOwnRecords()
      if (cancellation.tracksExecutions) {
        const running = await countRunningExecutions(client, organizationId, ids)
        if (running > 0) throw explorerErrors.cancelInFlight(running)
      }
      const batch = await client.query<{ id: string }>(
        `insert into data_record_cancellations (organization_id, dataset, reason, row_count, indicator_rules, cancelled_by_person_id, cancelled_by_account_id) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [organizationId, dataset.code, reason, ids.length, JSON.stringify(await snapshotIndicatorRules(client, organizationId, cancellation, ids)), actor.personId, actor.accountId],
      )
      const cancellationId = batch.rows[0]!.id
      // `cancellation.table` é fixo no catálogo; nada do pedido entra no texto do comando.
      const updated = await client.query(`update ${cancellation.table} set cancelled_at = now(), cancellation_id = $1 where organization_id = $2 and id = any($3::uuid[]) and cancelled_at is null`, [cancellationId, organizationId, ids])
      if (updated.rowCount !== ids.length) throw explorerErrors.cancelScopeChanged()
      await recordExplorerAudit(client, { organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_RECORDS_CANCELLED", result: "OK", dataset: dataset.code, durationMs: (deps.now ?? Date.now)() - startedAt, rows: ids.length, cancellationId, filterColumns: filterColumnsOf(query.filter), filterConditions: query.conditionCount, searched: query.search !== null, byKeys: scope.keys !== null })
      return { cancellationId, rows: ids.length }
    })
  } catch (error) {
    const failure = toWriteError(error)
    await auditRefusal(deps, actor, "DATA_HUB_RECORDS_CANCELLED", knownDataset(raw), failure, startedAt)
    throw failure
  }
}

export async function listCancellations(deps: ExplorerDeps, actor: ExplorerActor, datasetCode: string) {
  const startedAt = (deps.now ?? Date.now)()
  const dataset = requireDataset(datasetCode, actor.access)
  if (!dataset.cancellation) throw explorerErrors.cancelNotAvailable()
  const { table } = dataset.cancellation
  const rows = await withExplorerSession(deps.db, { kind: "QUERY", organizationId: actor.organizationId, accountId: actor.accountId, limits: deps.limits }, async (client) => {
    // Lote que ainda tem cancelado vem primeiro: é o único lugar da tela de onde ele pode ser reativado.
    const result = await client.query<{ id: string; reason: string; row_count: number; remaining: number; created_at: Date; cancelled_by: string | null; reactivated_at: Date | null; reactivated_by: string | null; reactivated_rows: number | null }>(
      `select c.id, c.reason, c.row_count, c.created_at, c.reactivated_at, c.reactivated_rows, cp.name cancelled_by, rp.name reactivated_by, left_rows.remaining
         from data_record_cancellations c
         cross join lateral (select count(*)::int remaining from ${table} r where r.cancellation_id = c.id) left_rows
         left join people cp on cp.id = c.cancelled_by_person_id and cp.organization_id = c.organization_id
         left join people rp on rp.id = c.reactivated_by_person_id and rp.organization_id = c.organization_id
        where c.organization_id = $1 and c.dataset = $2
        order by (left_rows.remaining > 0) desc, c.created_at desc, c.id desc limit $3`,
      [actor.organizationId, dataset.code, LIST_LIMIT + 1],
    )
    return result.rows
  })
  const page = rows.slice(0, LIST_LIMIT)
  // O motivo foi escrito à mão e a lista traz nomes: sem registro, sem dado, como na consulta.
  await recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_RECORDS_CANCEL_LIST", result: "OK", dataset: dataset.code, durationMs: (deps.now ?? Date.now)() - startedAt, rows: page.length, personalColumns: ["cancel_reason", "cancelled_by", "reactivated_by"] })
  return {
    items: page.map((row) => ({ id: row.id, reason: row.reason, rows: row.row_count, remaining: row.remaining, createdAt: row.created_at.toISOString(), cancelledBy: row.cancelled_by, reactivatedAt: row.reactivated_at?.toISOString() ?? null, reactivatedBy: row.reactivated_by, reactivatedRows: row.reactivated_rows })),
    hasMore: rows.length > LIST_LIMIT,
  }
}

/** O lote é sempre lido junto com a organização da sessão: id de outra organização é "não existe". */
async function requireBatch(client: pg.ClientBase, actor: ExplorerActor, id: string) {
  if (!UUID.test(id)) throw explorerErrors.cancellationNotFound()
  const batch = (await client.query<{ id: string; dataset: string; indicator_rules: IndicatorRuleSnapshot }>(`select id, dataset, indicator_rules from data_record_cancellations where id = $1 and organization_id = $2`, [id, actor.organizationId])).rows[0]
  if (!batch) throw explorerErrors.cancellationNotFound()
  const dataset = requireDataset(batch.dataset, actor.access)
  if (!dataset.cancellation) throw explorerErrors.cancellationNotFound()
  return { batch, dataset, cancellation: dataset.cancellation }
}

/** Confere o lote contra o indicador de agora e devolve quantos registros cada motivo barra. Agrupa por indicador: as tabelas e colunas são fixas, do catálogo. */
async function findReactivationProblems(client: pg.ClientBase, organizationId: string, cancellation: ExplorerCancellation, batchId: string, snapshot: IndicatorRuleSnapshot): Promise<{ rows: number; problems: { code: ReactivationProblem; count: number; message: string }[] }> {
  const { rule, table } = cancellation
  if (rule === "NONE") {
    const total = await client.query<{ total: number }>(`select count(*)::int total from ${table} where organization_id = $1 and cancellation_id = $2`, [organizationId, batchId])
    return { rows: total.rows[0]?.total ?? 0, problems: [] }
  }
  const daily = rule === "MEASUREMENT" ? "granularity = 'DAILY'" : "false"
  const groups = (await client.query<{ indicator_definition_id: string; daily: boolean; total: number }>(`select indicator_definition_id, ${daily} daily, count(*)::int total from ${table} where organization_id = $1 and cancellation_id = $2 group by 1, 2`, [organizationId, batchId])).rows
  const indicators = new Map(
    (
      await client.query<ReactivationIndicator>(
        `select id, active, code, unit, desired_direction direction, operational_aggregation aggregation, daily_supported "dailySupported", official_closure_supported "officialClosureSupported" from indicator_definitions where organization_id = $1 and id = any($2::uuid[])`,
        [organizationId, [...new Set(groups.map((group) => group.indicator_definition_id))]],
      )
    ).rows.map((indicator) => [indicator.id, indicator]),
  )
  const counts = new Map<ReactivationProblem, number>()
  let rows = 0
  for (const group of groups) {
    rows += group.total
    const requires = rule === "OFFICIAL_CLOSURE" ? "OFFICIAL_CLOSURE" : group.daily ? "DAILY_MEASUREMENT" : null
    const problem = reactivationProblem(snapshot, indicators.get(group.indicator_definition_id), { requires })
    if (problem) counts.set(problem, (counts.get(problem) ?? 0) + group.total)
  }
  if (rule === "MEASUREMENT") {
    // A chave da medição inclui a origem e o fim do período, e o cálculo não deduplica: outra linha ativa da mesma pessoa no mesmo período faria o dia contar duas vezes.
    const overlapping = await client.query<{ total: number }>(
      `select count(*)::int total from ${table} t
        where t.organization_id = $1 and t.cancellation_id = $2
          and exists (select 1 from ${table} a where a.organization_id = t.organization_id and a.indicator_definition_id = t.indicator_definition_id and a.subject_type = t.subject_type and a.subject_id = t.subject_id
                         and a.granularity = t.granularity and a.cancelled_at is null and a.period_start < t.period_end and a.period_end > t.period_start)`,
      [organizationId, batchId],
    )
    const total = overlapping.rows[0]?.total ?? 0
    if (total > 0) counts.set("ACTIVE_RECORD_IN_PERIOD", total)
  }
  return { rows, problems: [...counts].map(([code, count]) => ({ code, count, message: REACTIVATION_PROBLEMS[code] })) }
}

export async function previewReactivation(deps: ExplorerDeps, actor: ExplorerActor, id: string) {
  const startedAt = (deps.now ?? Date.now)()
  const preview = await withExplorerSession(deps.db, { kind: "QUERY", organizationId: actor.organizationId, accountId: actor.accountId, limits: deps.limits }, async (client) => {
    const { batch, dataset, cancellation } = await requireBatch(client, actor, id)
    const { rows, problems } = await findReactivationProblems(client, actor.organizationId, cancellation, id, batch.indicator_rules)
    const runInProgress = await hasRunInProgress(client, actor.organizationId, cancellation.contractKey)
    // Quem cancelou foi outra pessoa, mas reativar também decide se os resultados valem: a mesma regra do cancelamento.
    const ownRecords = await includesOwnRecords(client, cancellation, actor.personId, actor.organizationId, { cancellationId: id })
    const blockers: { code: string; message: string }[] = []
    const refuse = (error: DomainError) => blockers.push({ code: error.code, message: error.message })
    if (rows === 0) refuse(explorerErrors.reactivationNothing())
    if (runInProgress) refuse(explorerErrors.cancelRunInProgress())
    if (ownRecords) refuse(explorerErrors.cancelOwnRecords("reativar"))
    return { dataset: dataset.code, rows, problems, blockers, notices: ["Os registros voltam como estavam, com os mesmos valores, e voltam a entrar nos cálculos. Nenhum Workflow roda por causa disso."], canReactivate: rows > 0 && problems.length === 0 && blockers.length === 0 }
  })
  const { dataset, ...result } = preview
  await recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_RECORDS_REACTIVATION_PREVIEW", result: "OK", dataset, durationMs: (deps.now ?? Date.now)() - startedAt, rows: result.rows, cancellationId: id })
  return result
}

export async function executeReactivation(deps: ExplorerDeps, actor: ExplorerActor, id: string, raw: unknown) {
  const startedAt = (deps.now ?? Date.now)()
  let datasetCode: string | null = null
  try {
    const parsed = reactivateSchema.safeParse(raw)
    if (!parsed.success) throw explorerErrors.invalidRequest()
    return await withWriteTransaction(deps, actor.organizationId, async (client) => {
      const { batch, dataset, cancellation } = await requireBatch(client, actor, id)
      datasetCode = dataset.code
      if (await hasRunInProgress(client, actor.organizationId, cancellation.contractKey)) throw explorerErrors.cancelRunInProgress()
      // Trava antes de conferir: uma carga no meio não muda o que foi conferido.
      await client.query(`select 1 from ${cancellation.table} where organization_id = $1 and cancellation_id = $2 for update`, [actor.organizationId, id])
      const { rows, problems } = await findReactivationProblems(client, actor.organizationId, cancellation, id, batch.indicator_rules)
      if (rows === 0) throw explorerErrors.reactivationNothing()
      // Depois da trava: os registros conferidos são os que voltam.
      if (await includesOwnRecords(client, cancellation, actor.personId, actor.organizationId, { cancellationId: id })) throw explorerErrors.cancelOwnRecords("reativar")
      if (problems.length > 0) throw explorerErrors.reactivationBlocked(problems.map(({ code, count }) => ({ code, count })))
      if (rows !== parsed.data.expectedRows) throw explorerErrors.cancelScopeChanged()
      const updated = await client.query(`update ${cancellation.table} set cancelled_at = null, cancellation_id = null where organization_id = $1 and cancellation_id = $2`, [actor.organizationId, id])
      await client.query(`update data_record_cancellations set reactivated_at = now(), reactivated_by_person_id = $1, reactivated_rows = coalesce(reactivated_rows, 0) + $2 where id = $3 and organization_id = $4`, [actor.personId, updated.rowCount ?? 0, id, actor.organizationId])
      await recordExplorerAudit(client, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_RECORDS_REACTIVATED", result: "OK", dataset: dataset.code, durationMs: (deps.now ?? Date.now)() - startedAt, rows: updated.rowCount ?? 0, cancellationId: id })
      return { rows: updated.rowCount ?? 0 }
    })
  } catch (error) {
    const failure = toWriteError(error)
    await auditRefusal(deps, actor, "DATA_HUB_RECORDS_REACTIVATED", datasetCode, failure, startedAt)
    throw failure
  }
}
