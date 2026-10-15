import { DomainError } from "../../../shared/domain/domain-error.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { requireDataContract } from "../domain/contract-registry.js"
import { DataRunError, type RecordError } from "../domain/error-codes.js"
import { expectedIntervalMinutes, nextSyncAt } from "../domain/freshness.js"
import { feedMappingSchema, mapRecord, suggestMapping, validateMapping, type FeedMapping, type SourceRecord } from "../domain/mapping.js"
import { columnsFromRecords, fingerprintColumns, missingMappedSources } from "../domain/schema-fingerprint.js"
import { feedInputSchema, type FeedInput } from "../domain/source-config.js"
import { extractRecords, fetchApiRecords } from "./connectors/api-pull-connector.js"
import { parseFileBatch, type FetchedBatch } from "./connectors/file-connector.js"
import { fetchSftpSample } from "./connectors/sftp-connector.js"
import { fetchDatabaseSample, validateDatabaseFeed, type DatabaseObjectDescription } from "./connectors/database-connector.js"
import type { DataHubContext } from "./data-hub-context.js"
import { findFeed, recordAudit, requireFeed, requireSource, type DataFeedRow, type DataSourceRow } from "./records.js"
import { mapAll } from "./run-pipeline.js"
import type { Rejection } from "./writers/domain-writer.js"
import { requireWriter } from "./writers/writer-registry.js"

/**
 * Feeds: um conjunto de dados de uma fonte apontando para UM contrato. Amostra, sugestão de
 * mapping e preview têm ZERO efeito operacional: nenhum Run, nenhuma escrita no domínio,
 * nenhum Workflow — só leitura e cálculo.
 */
export const SAMPLE_SIZE = 20

function assertConnectorMatchesSource(source: DataSourceRow, input: Pick<FeedInput, "connectorConfig">): void {
  if (input.connectorConfig.connector !== source.kind) {
    throw new DomainError(`O conector do feed (${input.connectorConfig.connector}) precisa ser o mesmo tipo da fonte (${source.kind}).`, "DATA_FEED_CONNECTOR_MISMATCH", 422)
  }
}

async function computeNextSync(ctx: DataHubContext, organizationId: string, input: Pick<FeedInput, "cadence">, status: string): Promise<Date | null> {
  if (status !== "ACTIVE") return null
  const timeZone = await resolveOrganizationTimezone(ctx.db, organizationId)
  return nextSyncAt(input.cadence, ctx.clock.now(), timeZone)
}

/** Banco externo: o objeto e as colunas de sincronização são conferidos AO VIVO antes de salvar (nada é lido além do catálogo). */
async function assertDatabaseFeed(ctx: DataHubContext, source: DataSourceRow, input: Pick<FeedInput, "connectorConfig">): Promise<void> {
  if (input.connectorConfig.connector !== "DATABASE") return
  try {
    const resolved = await validateDatabaseFeed(ctx, source, input.connectorConfig.database)
    input.connectorConfig.database.object.kind = resolved.description.kind
  } catch (error) {
    if (error instanceof DataRunError) throw new DomainError(error.message, error.code, 422)
    throw error
  }
}

export async function createFeed(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, rawInput: unknown): Promise<DataFeedRow> {
  const source = await requireSource(ctx.db, organizationId, sourceId)
  const input = feedInputSchema.parse(rawInput)
  const contractVersion = requireDataContract(input.contractKey, input.contractVersion).version
  assertConnectorMatchesSource(source, input)
  await assertDatabaseFeed(ctx, source, input)
  try {
    const result = await ctx.db.query<{ id: string }>(
      `insert into data_feeds (organization_id, source_id, feed_key, name, contract_key, contract_version, connector_config, mapping, load_mode, cadence, expected_interval_minutes, status, authoritative, fail_on_any_rejection, source_namespace, created_by, updated_by, availability_policy)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12, $13, $14, $15, $15, $16) returning id`,
      [organizationId, sourceId, input.feedKey, input.name, input.contractKey, contractVersion, JSON.stringify(input.connectorConfig), JSON.stringify(input.mapping), input.loadMode, JSON.stringify(input.cadence), expectedIntervalMinutes(input.cadence), input.authoritative, input.failOnAnyRejection, input.sourceNamespace ?? null, actorId, input.availabilityPolicy ? JSON.stringify(input.availabilityPolicy) : null],
    )
    const feed = (await findFeed(ctx.db, organizationId, result.rows[0]!.id))!
    await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_FEED_CREATED", entityType: "data_feed", entityId: feed.id, payload: { sourceId, contract: `${feed.contractKey}@${feed.contractVersion}` } })
    return feed
  } catch (error) {
    throw translateUniqueViolation(error, input)
  }
}

function translateUniqueViolation(error: unknown, input: Pick<FeedInput, "feedKey" | "contractKey">): unknown {
  const code = (error as { code?: string; constraint?: string }).code
  const constraint = (error as { constraint?: string }).constraint
  if (code !== "23505") return error
  if (constraint === "data_feeds_authoritative_uk") return new DomainError(`Já existe um feed autoritativo ativo para ${input.contractKey} nesta organização. Desmarque o outro antes — duas fontes não podem ser master do mesmo cadastro.`, "DATA_FEED_AUTHORITATIVE_CONFLICT", 409)
  if (constraint === "data_feeds_source_id_feed_key_key") return new DomainError(`Já existe um feed com a chave "${input.feedKey}" nesta fonte.`, "DATA_FEED_KEY_CONFLICT", 409)
  return error
}

export async function updateFeed(ctx: DataHubContext, organizationId: string, actorId: string | null, feedId: string, rawInput: unknown): Promise<DataFeedRow> {
  const current = await requireFeed(ctx.db, organizationId, feedId)
  const source = await requireSource(ctx.db, organizationId, current.sourceId)
  const partial = feedInputSchema.partial().parse(rawInput)
  const merged: FeedInput = feedInputSchema.parse({
    feedKey: partial.feedKey ?? current.feedKey,
    name: partial.name ?? current.name,
    contractKey: partial.contractKey ?? current.contractKey,
    // Trocar de contrato (feed sem cargas) leva à versão atual do novo; o mesmo contrato mantém a versão do feed.
    contractVersion: partial.contractVersion ?? (partial.contractKey && partial.contractKey !== current.contractKey ? undefined : current.contractVersion),
    connectorConfig: partial.connectorConfig ?? current.connectorConfig,
    mapping: partial.mapping ?? current.mapping,
    loadMode: partial.loadMode ?? current.loadMode,
    cadence: partial.cadence ?? current.cadence,
    authoritative: partial.authoritative ?? current.authoritative,
    failOnAnyRejection: partial.failOnAnyRejection ?? current.failOnAnyRejection,
    sourceNamespace: partial.sourceNamespace ?? current.sourceNamespace ?? undefined,
    availabilityPolicy: partial.availabilityPolicy === undefined ? current.availabilityPolicy : partial.availabilityPolicy,
  })
  const contractVersion = requireDataContract(merged.contractKey, merged.contractVersion).version
  assertConnectorMatchesSource(source, merged)
  if (partial.connectorConfig) await assertDatabaseFeed(ctx, source, merged)
  const contractChanged = merged.contractKey !== current.contractKey
  if (contractChanged) {
    const runs = await ctx.db.query<{ count: number }>(`select count(*)::int count from data_ingestion_runs where feed_id = $1`, [feedId])
    if ((runs.rows[0]?.count ?? 0) > 0) throw new DomainError("O contrato de um feed que já teve cargas não pode mudar — crie outro feed.", "DATA_FEED_CONTRACT_LOCKED", 409)
  }
  const nextSync = await computeNextSync(ctx, organizationId, merged, current.status)
  try {
    await ctx.db.query(
      `update data_feeds set feed_key = $2, name = $3, contract_key = $4, contract_version = $5, connector_config = $6, mapping = $7, load_mode = $8, cadence = $9,
         expected_interval_minutes = $10, authoritative = $11, fail_on_any_rejection = $12, source_namespace = $13, next_sync_at = $14, updated_by = $15, updated_at = now(),
         availability_policy = $16
       where id = $1`,
      [feedId, merged.feedKey, merged.name, merged.contractKey, contractVersion, JSON.stringify(merged.connectorConfig), JSON.stringify(merged.mapping), merged.loadMode, JSON.stringify(merged.cadence), expectedIntervalMinutes(merged.cadence), merged.authoritative, merged.failOnAnyRejection, merged.sourceNamespace ?? null, nextSync, actorId, merged.availabilityPolicy ? JSON.stringify(merged.availabilityPolicy) : null],
    )
  } catch (error) {
    throw translateUniqueViolation(error, merged)
  }
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_FEED_UPDATED", entityType: "data_feed", entityId: feedId, payload: { mappingChanged: Boolean(partial.mapping), cadenceChanged: Boolean(partial.cadence), availabilityPolicyChanged: partial.availabilityPolicy !== undefined, ...(contractVersion !== current.contractVersion ? { contract: `${merged.contractKey}@${contractVersion}`, previousContract: `${current.contractKey}@${current.contractVersion}` } : {}) } })
  return (await findFeed(ctx.db, organizationId, feedId))!
}

export async function setFeedStatus(ctx: DataHubContext, organizationId: string, actorId: string | null, feedId: string, action: "ACTIVATE" | "PAUSE" | "RESUME"): Promise<DataFeedRow> {
  const feed = await requireFeed(ctx.db, organizationId, feedId)
  if (action === "ACTIVATE" || action === "RESUME") {
    const contract = requireDataContract(feed.contractKey, feed.contractVersion)
    const problems = validateMapping(contract, feedMappingSchema.parse(feed.mapping))
    if (problems.length > 0) throw new DomainError(`O mapeamento está incompleto: ${problems.join(" ")}`, "DATA_MAPPING_INVALID", 422, { problems })
  }
  if (action === "PAUSE" && feed.status === "DRAFT") throw new DomainError("Um rascunho não pode ser pausado — ative-o primeiro.", "DATA_FEED_INVALID_TRANSITION", 409)
  const next = action === "PAUSE" ? "PAUSED" : "ACTIVE"
  const nextSync = await computeNextSync(ctx, organizationId, feed, next)
  await ctx.db.query(`update data_feeds set status = $2, next_sync_at = $3, schema_changed_at = case when $2 = 'ACTIVE' then null else schema_changed_at end, updated_by = $4, updated_at = now() where id = $1`, [feedId, next, nextSync, actorId])
  // Ativar o primeiro feed de uma fonte em rascunho ativa a fonte junto (fluxo do wizard).
  if (next === "ACTIVE") await ctx.db.query(`update data_sources set status = 'ACTIVE', updated_at = now() where id = $1 and status = 'DRAFT'`, [feed.sourceId])
  await recordAudit(ctx.db, { organizationId, actorId, action: `DATA_HUB_FEED_${action}D`, entityType: "data_feed", entityId: feedId })
  return (await findFeed(ctx.db, organizationId, feedId))!
}

export async function deleteFeed(ctx: DataHubContext, organizationId: string, actorId: string | null, feedId: string): Promise<void> {
  await requireFeed(ctx.db, organizationId, feedId)
  await ctx.db.query(`update data_feeds set deleted_at = now(), status = 'PAUSED', next_sync_at = null, updated_by = $2, updated_at = now() where id = $1`, [feedId, actorId])
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_FEED_DELETED", entityType: "data_feed", entityId: feedId })
}

// ---------------------------------------------------------------------------------------------
// Amostra e preview (zero efeitos)
// ---------------------------------------------------------------------------------------------
export type SampleResult = { columns: string[]; records: SourceRecord[]; totalRecords: number; detail: string | null; suggestedMapping: FeedMapping; sheets?: string[]; rawObjectId?: string | null; database?: DatabaseObjectDescription }

/** Amostra a partir de um objeto bruto já enviado (upload) ou da própria fonte (API Pull/SFTP). */
export async function fetchSample(ctx: DataHubContext, organizationId: string, input: { source: DataSourceRow; feed: DataFeedRow | null; connectorConfig: FeedInput["connectorConfig"]; contractKey: string; rawObjectId?: string | null }): Promise<SampleResult> {
  const contract = requireDataContract(input.contractKey)
  let batch: FetchedBatch
  if (input.rawObjectId) {
    const raw = await ctx.rawObjects.get(input.rawObjectId, organizationId)
    if (!raw) throw new DomainError("O arquivo enviado expirou — envie novamente.", "DATA_RAW_EXPIRED", 422)
    if (input.connectorConfig.connector === "API_PUSH" || raw.meta.contentType === "application/json") {
      const records = extractRecords(JSON.parse(new TextDecoder().decode(raw.content)), input.connectorConfig.connector === "API_PUSH" ? input.connectorConfig.push.extractPath : "")
      batch = { columns: columnsFromRecords(records.slice(0, SAMPLE_SIZE)), records: records.slice(0, SAMPLE_SIZE), bytes: raw.meta.byteSize, totalRecords: records.length, detail: null }
    } else {
      const fileConfig = input.connectorConfig.connector === "FILE_UPLOAD" ? input.connectorConfig.file : input.connectorConfig.connector === "SFTP" ? input.connectorConfig.sftp : null
      if (!fileConfig) throw new DomainError("Este conector não lê arquivos.", "DATA_FEED_CONNECTOR_MISMATCH", 422)
      batch = await parseFileBatch(fileConfig, raw.content, SAMPLE_SIZE)
    }
  } else if (input.connectorConfig.connector === "API_PULL") {
    const feed: DataFeedRow = input.feed ?? draftFeed(input.source, input.connectorConfig, input.contractKey)
    batch = await fetchApiRecords(ctx, input.source, { ...feed, connectorConfig: input.connectorConfig }, { checkpoint: null, limit: SAMPLE_SIZE })
  } else if (input.connectorConfig.connector === "SFTP") {
    const feed: DataFeedRow = input.feed ?? draftFeed(input.source, input.connectorConfig, input.contractKey)
    const file = await fetchSftpSample(ctx, input.source, { ...feed, connectorConfig: input.connectorConfig })
    batch = await parseFileBatch(input.connectorConfig.sftp, file.content, SAMPLE_SIZE)
    batch.detail = `${file.entry.name} · ${batch.detail ?? ""}`
  } else if (input.connectorConfig.connector === "DATABASE") {
    if (input.source.kind !== "DATABASE") throw new DomainError("Esta fonte não é um banco de dados.", "DATA_FEED_CONNECTOR_MISMATCH", 422)
    try {
      const fetched = await fetchDatabaseSample(ctx, input.source, { connectorConfig: input.connectorConfig })
      const result: SampleResult = { columns: fetched.columns, records: fetched.records, totalRecords: fetched.totalRecords, detail: fetched.detail, suggestedMapping: suggestMapping(contract, fetched.columns, fetched.records), rawObjectId: null, database: fetched.description }
      return result
    } catch (error) {
      if (error instanceof DataRunError) throw new DomainError(error.message, error.code, 422)
      throw error
    }
  } else {
    throw new DomainError("Envie um arquivo (ou payload de exemplo) para obter a amostra desta fonte.", "DATA_SAMPLE_REQUIRES_UPLOAD", 422)
  }
  const result: SampleResult = { columns: batch.columns, records: batch.records.slice(0, SAMPLE_SIZE), totalRecords: batch.totalRecords, detail: batch.detail, suggestedMapping: suggestMapping(contract, batch.columns, batch.records), rawObjectId: input.rawObjectId ?? null }
  if (batch.sheets) result.sheets = batch.sheets
  return result
}

export function draftFeed(source: DataSourceRow, connectorConfig: FeedInput["connectorConfig"], contractKey: string): DataFeedRow {
  const now = new Date().toISOString()
  return {
    id: "00000000-0000-4000-8000-000000000000",
    organizationId: source.organizationId,
    sourceId: source.id,
    feedKey: "draft",
    name: "draft",
    contractKey,
    contractVersion: requireDataContract(contractKey).version,
    connectorConfig,
    mapping: { fields: [] },
    loadMode: "DELTA",
    cadence: { kind: "MANUAL" },
    expectedIntervalMinutes: null,
    status: "DRAFT",
    authoritative: false,
    failOnAnyRejection: false,
    sourceNamespace: null,
    availabilityPolicy: null,
    schemaFingerprint: null,
    schemaChangedAt: null,
    checkpoint: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastDataAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextSyncAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export type PreviewRow = { recordNumber: number; sourceRecordKey: string | null; valid: boolean; record: Record<string, unknown>; errors: RecordError[]; normalized: Record<string, string | null> }
export type PreviewResult = {
  rows: PreviewRow[]
  sampled: number
  valid: number
  rejected: number
  mappingProblems: string[]
  schemaWarnings: { field: string; source: string; required: boolean }[]
  fingerprint: { columns: string[]; hash: string }
  errorSummary: { code: string; count: number }[]
}

/** Mapping (rascunho) × amostra → ✓/✕ por registro, com erros por campo. Só leitura (prepare do writer não escreve). */
export async function previewMapping(ctx: DataHubContext, organizationId: string, input: { source: DataSourceRow; feed: DataFeedRow | null; contractKey: string; mapping: unknown; sample: { columns: string[]; records: SourceRecord[] } }): Promise<PreviewResult> {
  const contract = requireDataContract(input.contractKey)
  const mapping = feedMappingSchema.parse(input.mapping)
  const mappingProblems = validateMapping(contract, mapping)
  const timeZone = await resolveOrganizationTimezone(ctx.db, organizationId)
  const records = input.sample.records.slice(0, SAMPLE_SIZE)
  const keyField = contract.fields.find((field) => field.identity)?.key
  const mapped = mapAll(contract, mapping, records, timeZone, keyField)
  const feed = input.feed ?? draftFeed(input.source, { connector: "FILE_UPLOAD", file: { format: "CSV", csv: { encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }, contract.key)
  let prepared: { rejections: Rejection[] } = { rejections: [] }
  try {
    prepared = await requireWriter(contract.key).prepare({ ctx, organizationId, timeZone, feed, runId: "preview", sourceNamespace: feed.sourceNamespace ?? input.source.publicId }, mapped.valid)
  } catch (error) {
    if (!(error instanceof DataRunError)) throw error
    mappingProblems.push(error.message)
  }
  const errorsByRecord = new Map<number, RecordError[]>()
  for (const rejection of [...mapped.rejections, ...prepared.rejections]) {
    if (!errorsByRecord.has(rejection.recordNumber)) errorsByRecord.set(rejection.recordNumber, [])
    errorsByRecord.get(rejection.recordNumber)!.push(rejection.error)
  }
  const mappingByNumber = new Map<number, Record<string, unknown>>()
  const keyByNumber = new Map<number, string | null>()
  for (const valid of mapped.valid) {
    mappingByNumber.set(valid.recordNumber, valid.record)
    keyByNumber.set(valid.recordNumber, valid.sourceRecordKey)
  }
  const rows: PreviewRow[] = records.map((source, index) => {
    const recordNumber = index + 1
    const errors = errorsByRecord.get(recordNumber) ?? []
    const record = mappingByNumber.get(recordNumber) ?? remapForDisplay(contract, mapping, source, timeZone)
    // Valor de origem × valor normalizado (situação funcional, regime): a normalização é a mesma do writer.
    const normalized: Record<string, string | null> = {}
    for (const [field, normalize] of Object.entries(contract.displayNormalizers ?? {})) {
      const value = record[field]
      if (value !== null && value !== undefined && value !== "") normalized[field] = normalize(value)
    }
    return { recordNumber, sourceRecordKey: keyByNumber.get(recordNumber) ?? null, valid: errors.length === 0, record, errors, normalized }
  })
  const summary = new Map<string, number>()
  for (const errors of errorsByRecord.values()) for (const error of errors) summary.set(error.code, (summary.get(error.code) ?? 0) + 1)
  const fingerprint = fingerprintColumns(input.sample.columns)
  return {
    rows,
    sampled: records.length,
    valid: rows.filter((row) => row.valid).length,
    rejected: rows.filter((row) => !row.valid).length,
    mappingProblems,
    schemaWarnings: missingMappedSources(contract, mapping, records, input.sample.columns),
    fingerprint: { columns: fingerprint.columns, hash: fingerprint.hash },
    errorSummary: [...summary.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
  }
}

function remapForDisplay(contract: ReturnType<typeof requireDataContract>, mapping: FeedMapping, source: SourceRecord, timeZone: string): Record<string, unknown> {
  return mapRecord(contract, mapping, source, { timeZone: mapping.timeZone ?? timeZone }).record
}
