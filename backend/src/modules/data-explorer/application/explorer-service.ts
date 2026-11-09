import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { canOrganizationWide, type AccessContext } from "../../access/domain/access-decision.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { describeExplorerDataset, EXPLORER_DATASETS, findExplorerDataset, summarizeExplorerDataset } from "../domain/explorer-catalog.js"
import type { ExplorerDataset } from "../domain/explorer-catalog-types.js"
import { CANCELLED_ALIAS, compileCountQuery, compileExportQuery, compilePageQuery, KEY_ALIAS, SORT_ALIAS } from "../domain/explorer-compiler.js"
import { createInstantFormatter, csvHeaderLine, csvRowLine } from "../domain/explorer-csv.js"
import { decodeExplorerCursor, encodeExplorerCursor } from "../domain/explorer-cursor.js"
import { explorerErrors, ExportInterrupted, type ExportInterruption } from "../domain/explorer-errors.js"
import type { ExplorerLimits } from "../domain/explorer-limits.js"
import { filterColumnsOf, parseExplorerRequest, resolveExplorerQuery, resolvePageSize, type ExplorerQuery, type ExplorerRequest } from "../domain/explorer-query.js"
import { visibleDeletedItemTypes } from "./deleted-items-service.js"
import { recordExplorerAudit, type ExplorerAuditAction, type ExplorerAuditEntry } from "./explorer-audit.js"
import { toExplorerError, withExplorerSession } from "./read-only-session.js"

const log = createLogger("data-explorer")

export type ExplorerActor = { organizationId: string; accountId: string; personId: string | null; access: AccessContext }
export type ExplorerDeps = { db: Database; limits: ExplorerLimits; now?: () => number }

const nowOf = (deps: ExplorerDeps) => (deps.now ?? Date.now)()

/** Conjunto com permissão própria só aparece para quem a tem. Sem ela, a mesma resposta de um conjunto que não existe. */
function canSeeDataset(dataset: ExplorerDataset, access: AccessContext): boolean {
  return dataset.requiresPermission === undefined || canOrganizationWide(access, dataset.requiresPermission)
}

export function requireDataset(code: string, access: AccessContext): ExplorerDataset {
  const dataset = findExplorerDataset(code)
  if (!dataset || !canSeeDataset(dataset, access)) throw explorerErrors.datasetNotFound()
  return dataset
}

export function publicLimits(limits: ExplorerLimits) {
  return {
    defaultPageSize: limits.defaultPageSize,
    maxPageSize: limits.maxPageSize,
    maxSelectedColumns: limits.maxSelectedColumns,
    maxFilterConditions: limits.maxFilterConditions,
    maxFilterDepth: limits.maxFilterDepth,
    maxListValues: limits.maxListValues,
    minSearchLength: limits.minSearchLength,
    maxSearchLength: limits.maxSearchLength,
    queryTimeoutSeconds: Math.round(limits.queryTimeoutMs / 1000),
    countCap: limits.countCap,
    exportMaxRows: limits.exportMaxRows,
    exportMaxBytes: limits.exportMaxBytes,
    cancelMaxRows: limits.cancelMaxRows,
    cancelMaxKeys: limits.cancelMaxKeys,
  }
}

/** Conta quem pode cancelar: o catálogo diz o que é cancelável, a permissão diz quem. Sem ela, a tela nem recebe as chaves dos registros. */
const canCancelRecords = (dataset: ExplorerDataset, access: AccessContext) => dataset.cancellation !== undefined && canOrganizationWide(access, "data_hub.cancel_records")

export function listExplorerDatasets(deps: Pick<ExplorerDeps, "limits">, access: AccessContext) {
  return { datasets: EXPLORER_DATASETS.filter((dataset) => canSeeDataset(dataset, access)).map(summarizeExplorerDataset), deletedItemTypes: visibleDeletedItemTypes(access), limits: publicLimits(deps.limits) }
}

export function describeDataset(code: string, access: AccessContext) {
  const dataset = requireDataset(code, access)
  return { ...describeExplorerDataset(dataset), canCancel: canCancelRecords(dataset, access) }
}

type ResolvedRequest = { request: ExplorerRequest; dataset: ExplorerDataset; query: ExplorerQuery }

function auditShape(query: ExplorerQuery) {
  return {
    columns: query.columns.map((column) => column.key),
    personalColumns: query.columns.filter((column) => column.personal).map((column) => column.key),
    filterColumns: filterColumnsOf(query.filter),
    filterConditions: query.conditionCount,
    searched: query.search !== null,
    sort: `${query.sort.column.key}:${query.sort.direction}`,
    ...(query.dataset.cancellation ? { recordStatus: query.recordStatus } : {}),
  }
}

/** Código de conjunto só entra na auditoria se existir no catálogo: texto inventado pelo cliente não é gravado. */
export function knownDataset(raw: unknown): string | null {
  const code = typeof raw === "object" && raw !== null ? (raw as { dataset?: unknown }).dataset : null
  return typeof code === "string" && findExplorerDataset(code) ? code : null
}

function resolveRequest(raw: unknown, actor: ExplorerActor, limits: ExplorerLimits): ResolvedRequest {
  const request = parseExplorerRequest(raw)
  const dataset = requireDataset(request.dataset, actor.access)
  return { request, dataset, query: resolveExplorerQuery(request, dataset, limits) }
}

/** Recusa e falha também ficam registradas. Sem derrubar a resposta de erro, que já diz o que aconteceu. */
async function auditFailure(deps: ExplorerDeps, actor: ExplorerActor, action: ExplorerAuditAction, raw: unknown, error: DomainError, startedAt: number): Promise<void> {
  try {
    await recordExplorerAudit(deps.db, {
      organizationId: actor.organizationId,
      personId: actor.personId,
      accountId: actor.accountId,
      action,
      result: error.statusCode >= 500 ? "FAILED" : "REJECTED",
      dataset: knownDataset(raw),
      durationMs: nowOf(deps) - startedAt,
      errorCode: error.code,
    })
  } catch {
    log.error({ action, errorCode: error.code }, "não foi possível registrar a recusa da consulta na auditoria")
  }
}

export async function runExplorerQuery(deps: ExplorerDeps, actor: ExplorerActor, raw: unknown) {
  const startedAt = nowOf(deps)
  try {
    const { request, dataset, query } = resolveRequest(raw, actor, deps.limits)
    const pageSize = resolvePageSize(request, deps.limits)
    const cursor = request.cursor ? decodeExplorerCursor(query, request.cursor) : null
    const timeZone = await resolveOrganizationTimezone(deps.db, actor.organizationId)
    const compiled = compilePageQuery(query, { organizationId: actor.organizationId, timeZone, pageSize, cursor })
    const rows = await withExplorerSession(deps.db, { kind: "QUERY", organizationId: actor.organizationId, accountId: actor.accountId, limits: deps.limits }, async (client) => (await client.query<Record<string, string | boolean | null>>(compiled.sql, compiled.params)).rows)
    const hasMore = rows.length > pageSize
    const page = hasMore ? rows.slice(0, pageSize) : rows
    const last = page[page.length - 1]
    const durationMs = nowOf(deps) - startedAt
    // Sem registro, sem dado: a falha da auditoria impede a resposta.
    await recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_EXPLORER_QUERY", result: "OK", dataset: dataset.code, durationMs, rows: page.length, hasMore, ...auditShape(query) })
    return {
      columns: query.columns.map((column) => column.key),
      rows: page.map((row) => query.columns.map((_, index) => (row[`c${index}`] ?? null) as string | null)),
      // Registro já cancelado não tem chave: não há o que cancelar nele.
      rowKeys: canCancelRecords(dataset, actor.access) ? page.map((row) => (row[CANCELLED_ALIAS] === true ? null : String(row[KEY_ALIAS]))) : null,
      nextCursor: hasMore && last ? encodeExplorerCursor(query, { sort: (last[SORT_ALIAS] as string | null) ?? null, key: String(last[KEY_ALIAS]) }) : null,
      hasMore,
      pageSize,
      sort: { column: query.sort.column.key, direction: query.sort.direction },
      timeZone,
      durationMs,
    }
  } catch (error) {
    const failure = toExplorerError(error, { kind: "QUERY", limits: deps.limits })
    await auditFailure(deps, actor, "DATA_HUB_EXPLORER_QUERY", raw, failure, startedAt)
    throw failure
  }
}

export async function runExplorerCount(deps: ExplorerDeps, actor: ExplorerActor, raw: unknown) {
  const startedAt = nowOf(deps)
  try {
    const { dataset, query } = resolveRequest(raw, actor, deps.limits)
    const timeZone = await resolveOrganizationTimezone(deps.db, actor.organizationId)
    const cap = deps.limits.countCap
    const compiled = compileCountQuery(query, { organizationId: actor.organizationId, timeZone, cap })
    const total = await withExplorerSession(deps.db, { kind: "QUERY", organizationId: actor.organizationId, accountId: actor.accountId, limits: deps.limits }, async (client) => (await client.query<{ total: number }>(compiled.sql, compiled.params)).rows[0]?.total ?? 0)
    const capped = total > cap
    const durationMs = nowOf(deps) - startedAt
    await recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_EXPLORER_COUNT", result: "OK", dataset: dataset.code, durationMs, rows: 0, capped, ...auditShape(query) })
    return { count: Math.min(total, cap), capped, durationMs }
  } catch (error) {
    const failure = toExplorerError(error, { kind: "QUERY", limits: deps.limits })
    await auditFailure(deps, actor, "DATA_HUB_EXPLORER_COUNT", raw, failure, startedAt)
    throw failure
  }
}

/** Destino da exportação. A rota é quem conhece a resposta HTTP e a espera pelo navegador. */
export type ExplorerExportSink = {
  begin(filename: string): void
  /** Resolve quando pode escrever mais. Rejeita com o motivo se o cliente sumiu ou parou de baixar. */
  write(chunk: string): Promise<void>
  /** Encerra a conexão sem finalizar: o navegador acusa a falha, em vez de receber um arquivo cortado como se estivesse completo. */
  abort(): void
  finish(): void
}

const EXPORT_CURSOR = "inia_data_explorer_export"

const civilToday = (timeZone: string, instant: number) => new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant))

/**
 * Exportação em fluxo: cursor do banco lido em lotes, numa transação só (mesma foto do início ao fim), sem acumular o resultado em memória. Antes de
 * mandar a primeira linha, duas conferências que ainda podem responder com erro claro: o tamanho (contagem com teto) e o registro de auditoria.
 */
export async function runExplorerExport(deps: ExplorerDeps, actor: ExplorerActor, raw: unknown, sink: ExplorerExportSink): Promise<void> {
  const startedAt = nowOf(deps)
  const { limits } = deps
  let started = false
  let rows = 0
  let bytes = 0
  let audit: Pick<ExplorerAuditEntry, "dataset" | "columns" | "personalColumns" | "filterColumns" | "filterConditions" | "searched" | "sort"> | null = null
  const finish = (result: "OK" | "INTERRUPTED", interruption: ExportInterruption | null) =>
    recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_EXPLORER_EXPORT_FINISHED", result, dataset: audit?.dataset ?? null, durationMs: nowOf(deps) - startedAt, rows, bytes, interruption, ...(audit ?? {}) })
  try {
    const { dataset, query } = resolveRequest(raw, actor, limits)
    audit = { dataset: dataset.code, ...auditShape(query) }
    const timeZone = await resolveOrganizationTimezone(deps.db, actor.organizationId)
    const count = compileCountQuery(query, { organizationId: actor.organizationId, timeZone, cap: limits.exportMaxRows })
    const body = compileExportQuery(query, { organizationId: actor.organizationId, timeZone, maxRows: limits.exportMaxRows })
    const formatInstant = createInstantFormatter(timeZone)
    const deadline = startedAt + limits.exportMaxDurationMs

    await withExplorerSession(deps.db, { kind: "EXPORT", organizationId: actor.organizationId, accountId: actor.accountId, limits }, async (client) => {
      const total = (await client.query<{ total: number }>(count.sql, count.params)).rows[0]?.total ?? 0
      if (total > limits.exportMaxRows) throw explorerErrors.exportTooLarge(limits.exportMaxRows)
      // Sem registro, sem arquivo.
      await recordExplorerAudit(deps.db, { organizationId: actor.organizationId, personId: actor.personId, accountId: actor.accountId, action: "DATA_HUB_EXPLORER_EXPORT_STARTED", result: "OK", dataset: dataset.code, durationMs: nowOf(deps) - startedAt, rows: total, ...auditShape(query) })
      await client.query(`declare ${EXPORT_CURSOR} no scroll cursor for ${body.sql}`, body.params)

      sink.begin(`consulta-${dataset.code}-${civilToday(timeZone, nowOf(deps))}.csv`)
      started = true
      const send = async (chunk: string) => {
        bytes += Buffer.byteLength(chunk, "utf8")
        if (bytes > limits.exportMaxBytes) throw new ExportInterrupted("BYTES_LIMIT")
        await sink.write(chunk)
      }
      await send(csvHeaderLine(query.columns))
      for (;;) {
        if (nowOf(deps) > deadline) throw new ExportInterrupted("DURATION_LIMIT")
        const batch = await client.query<Record<string, string | null>>(`fetch forward ${limits.exportFetchRows} from ${EXPORT_CURSOR}`)
        if (batch.rows.length === 0) break
        let chunk = ""
        for (const row of batch.rows) chunk += csvRowLine(query.columns, query.columns.map((_, index) => row[`c${index}`] ?? null), formatInstant)
        rows += batch.rows.length
        await send(chunk)
        if (batch.rows.length < limits.exportFetchRows) break
      }
    })
    sink.finish()
    await finish("OK", null).catch(() => log.error({ dataset: dataset.code }, "exportação concluída sem o registro de fim na auditoria"))
  } catch (error) {
    if (started) {
      // O arquivo já começou: não há mais como responder com um erro, então a conexão cai e o navegador acusa a falha.
      sink.abort()
      const interruption: ExportInterruption = error instanceof ExportInterrupted ? error.interruption : "QUERY_FAILED"
      await finish("INTERRUPTED", interruption).catch(() => log.error({ interruption }, "exportação interrompida sem o registro de fim na auditoria"))
      return
    }
    const failure = toExplorerError(error, { kind: "EXPORT", limits })
    await auditFailure(deps, actor, "DATA_HUB_EXPLORER_EXPORT_FINISHED", raw, failure, startedAt)
    throw failure
  }
}
