import { z } from "zod"

import { adminGet, adminGetBlob, adminSend, adminUpload } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type ListParams, type PageResult } from "@/lib/admin/list-query"
import {
  auditEventSchema,
  configAccessSchema,
  connectionTestSchema,
  contractSchema,
  contractsCatalogSchema,
  databaseObjectDescriptionSchema,
  databaseObjectListSchema,
  feedSchema,
  feedSummarySchema,
  lineageEntrySchema,
  overviewSchema,
  previewSchema,
  pushTokenSchema,
  qualitySchema,
  rejectionSchema,
  runDetailSchema,
  cadencePreviewSchema,
  runListItemSchema,
  runSchema,
  sampleSchema,
  sftpFileSchema,
  sourceDetailSchema,
  sourceSchema,
  sourceSummarySchema,
  uploadResultSchema,
  type AuditEvent,
  type AvailabilityPolicy,
  type Cadence,
  type CadencePreview,
  type ConfigAccess,
  type ConnectionTest,
  type ContractsCatalog,
  type DataContract,
  type DatabaseConfig,
  type DatabaseObjectDescription,
  type DatabaseObjectList,
  type Feed,
  type FeedMapping,
  type FeedSummary,
  type LineageEntry,
  type Overview,
  type Preview,
  type PushToken,
  type QualityReport,
  type Rejection,
  type Run,
  type RunDetail,
  type RunListItem,
  type RunStatus,
  type RunTriggerKind,
  type Sample,
  type SftpFile,
  type Source,
  type SourceDetail,
  type SourceSummary,
  type UploadResult,
} from "@/schemas/admin/data-hub.schema"

const BASE = "/api/v1/admin/data-hub"

export async function fetchOverview(): Promise<Overview> {
  return overviewSchema.parse(await adminGet(`${BASE}/overview`))
}

export async function fetchQuality(): Promise<QualityReport> {
  return qualitySchema.parse(await adminGet(`${BASE}/quality`))
}

export async function fetchContracts(): Promise<ContractsCatalog> {
  return contractsCatalogSchema.parse(await adminGet(`${BASE}/contracts`))
}

export async function fetchContract(key: string): Promise<DataContract & { pushPayloadExample: { records: Record<string, unknown>[] } }> {
  return contractSchema.extend({ pushPayloadExample: z.object({ records: z.array(z.record(z.string(), z.unknown())) }) }).parse(await adminGet(`${BASE}/contracts/${key}`))
}

export async function fetchSources(): Promise<SourceSummary[]> {
  return z.array(sourceSummarySchema).parse(await adminGet(`${BASE}/sources`))
}

export async function fetchSource(id: string): Promise<SourceDetail> {
  return sourceDetailSchema.parse(await adminGet(`${BASE}/sources/${id}`))
}

export type SourceInput = { name: string; description?: string; config: Record<string, unknown>; secrets?: Record<string, string | undefined> }

export async function createSource(input: SourceInput): Promise<Source> {
  return sourceSchema.passthrough().parse(await adminSend(`${BASE}/sources`, "POST", input))
}

export async function updateSource(id: string, input: Partial<SourceInput>): Promise<Source> {
  return sourceSchema.passthrough().parse(await adminSend(`${BASE}/sources/${id}`, "PATCH", input))
}

export async function deleteSource(id: string): Promise<void> {
  await adminSend(`${BASE}/sources/${id}`, "DELETE")
}

export async function testSourceConnection(id: string): Promise<ConnectionTest> {
  return connectionTestSchema.parse(await adminSend(`${BASE}/sources/${id}/test-connection`, "POST"))
}

// ---- Banco de dados externo ---------------------------------------------------------------
/** Testa uma conexão de banco ANTES de salvar (nada é gravado). Sem senha + `sourceId` = usa a senha já guardada. */
export async function testDatabaseConnection(input: { config: DatabaseConfig; password?: string; sourceId?: string }): Promise<ConnectionTest> {
  return connectionTestSchema.parse(await adminSend(`${BASE}/database/test`, "POST", input))
}

export async function fetchDatabaseObjects(sourceId: string, search?: string): Promise<DatabaseObjectList> {
  return databaseObjectListSchema.parse(await adminGet(`${BASE}/sources/${sourceId}/database/objects${toQueryString({ search: search?.trim() || undefined })}`))
}

export async function fetchDatabaseColumns(sourceId: string, object: { schema: string; name: string }): Promise<DatabaseObjectDescription> {
  return databaseObjectDescriptionSchema.parse(await adminGet(`${BASE}/sources/${sourceId}/database/columns${toQueryString({ schema: object.schema, name: object.name })}`))
}

/** Recomeça a leitura de um conjunto de banco externo do início (nada é apagado; a próxima carga relê sem duplicar). */
export async function resetFeedCheckpoint(feedId: string): Promise<Feed> {
  return feedSchema.parse(await adminSend(`${BASE}/feeds/${feedId}/checkpoint/reset`, "POST"))
}

export async function setSourceStatus(id: string, action: "ACTIVATE" | "PAUSE" | "RESUME"): Promise<Source> {
  return sourceSchema.passthrough().parse(await adminSend(`${BASE}/sources/${id}/status`, "POST", { action }))
}

export async function rotateSourceSecrets(id: string, secrets: Record<string, string | undefined>): Promise<Source> {
  return sourceSchema.passthrough().parse(await adminSend(`${BASE}/sources/${id}/secrets`, "POST", secrets))
}

/** Credencial atual digitada de novo: libera a configuração por 30 minutos para esta pessoa, nesta fonte e nesta sessão. */
export async function unlockSourceConfiguration(id: string, secrets: Record<string, string | undefined>): Promise<ConfigAccess> {
  return configAccessSchema.parse(await adminSend(`${BASE}/sources/${id}/unlock-configuration`, "POST", secrets))
}

export type PushTokenInput = { label: string; feedId?: string | null; expiresInDays?: number | null; allowedNetworks?: string[] | null }

export async function createPushToken(sourceId: string, input: PushTokenInput): Promise<PushToken> {
  return pushTokenSchema.parse(await adminSend(`${BASE}/sources/${sourceId}/tokens`, "POST", input))
}

export async function revokePushToken(sourceId: string, tokenId: string): Promise<void> {
  await adminSend(`${BASE}/sources/${sourceId}/tokens/${tokenId}/revoke`, "POST")
}

export async function rotatePushToken(sourceId: string, tokenId: string): Promise<PushToken> {
  return pushTokenSchema.parse(await adminSend(`${BASE}/sources/${sourceId}/tokens/${tokenId}/rotate`, "POST"))
}

export async function fetchSourceSample(sourceId: string, input: { connectorConfig: Record<string, unknown>; contractKey: string; rawObjectId?: string | null }): Promise<Sample> {
  return sampleSchema.parse(await adminSend(`${BASE}/sources/${sourceId}/sample`, "POST", input))
}

export async function previewSourceMapping(sourceId: string, input: { contractKey: string; mapping: FeedMapping; sample: { columns: string[]; records: Record<string, unknown>[] } }): Promise<Preview> {
  return previewSchema.parse(await adminSend(`${BASE}/sources/${sourceId}/preview`, "POST", input))
}

export async function listSftpFiles(sourceId: string, connectorConfig: Record<string, unknown>): Promise<SftpFile[]> {
  return z.array(sftpFileSchema).parse(await adminSend(`${BASE}/sources/${sourceId}/sftp-files`, "POST", { connectorConfig }))
}

export async function uploadFile(input: { file: File; sourceId?: string; contractKey?: string; format?: "CSV" | "XLSX"; encoding?: string; delimiter?: string; sheet?: string }): Promise<UploadResult> {
  const form = new FormData()
  form.append("file", input.file)
  if (input.sourceId) form.append("sourceId", input.sourceId)
  if (input.contractKey) form.append("contractKey", input.contractKey)
  if (input.format) form.append("format", input.format)
  if (input.encoding) form.append("encoding", input.encoding)
  if (input.delimiter) form.append("delimiter", input.delimiter)
  if (input.sheet) form.append("sheet", input.sheet)
  return uploadResultSchema.parse(await adminUpload(`${BASE}/uploads`, form))
}

export async function fetchFeeds(sourceId: string): Promise<Feed[]> {
  return z.array(feedSchema).parse(await adminGet(`${BASE}/sources/${sourceId}/feeds`))
}

export async function fetchFeed(id: string): Promise<FeedSummary & { configAccess: ConfigAccess; source: { id: string; name: string; kind: string; publicId: string; status: string } | null }> {
  return feedSummarySchema.extend({ configAccess: configAccessSchema, source: z.object({ id: z.string(), name: z.string(), kind: z.string(), publicId: z.string(), status: z.string() }).nullable() }).parse(await adminGet(`${BASE}/feeds/${id}`))
}

export type FeedInput = {
  feedKey: string
  name: string
  contractKey: string
  /** Ausente = versão atual (feed novo) ou a do feed (edição). A tela envia a versão que mapeou. */
  contractVersion?: number
  connectorConfig: Record<string, unknown>
  mapping: FeedMapping
  loadMode?: "DELTA" | "SNAPSHOT"
  cadence?: Cadence
  authoritative?: boolean
  failOnAnyRejection?: boolean
  sourceNamespace?: string
  availabilityPolicy?: AvailabilityPolicy | null
}

/** Frase e próximas execuções de uma periodicidade ainda não salva, pelo mesmo cálculo do agendador e no fuso da operação. */
export async function fetchCadencePreview(cadence: Cadence): Promise<CadencePreview> {
  return cadencePreviewSchema.parse(await adminSend(`${BASE}/cadence/preview`, "POST", { cadence }))
}

export async function createFeed(sourceId: string, input: FeedInput): Promise<Feed> {
  return feedSchema.parse(await adminSend(`${BASE}/sources/${sourceId}/feeds`, "POST", input))
}

export async function updateFeed(id: string, input: Partial<FeedInput>): Promise<Feed> {
  return feedSchema.parse(await adminSend(`${BASE}/feeds/${id}`, "PATCH", input))
}

export async function deleteFeed(id: string): Promise<void> {
  await adminSend(`${BASE}/feeds/${id}`, "DELETE")
}

export async function setFeedStatus(id: string, action: "ACTIVATE" | "PAUSE" | "RESUME"): Promise<Feed> {
  return feedSchema.parse(await adminSend(`${BASE}/feeds/${id}/status`, "POST", { action }))
}

export async function syncFeedNow(id: string): Promise<Run> {
  return runSchema.parse(await adminSend(`${BASE}/feeds/${id}/sync`, "POST"))
}

export async function fetchFeedSample(id: string, rawObjectId?: string | null): Promise<Sample> {
  return sampleSchema.parse(await adminSend(`${BASE}/feeds/${id}/sample`, "POST", { rawObjectId: rawObjectId ?? null }))
}

export async function previewFeedMapping(id: string, input: { mapping?: FeedMapping; contractKey?: string; sample: { columns: string[]; records: Record<string, unknown>[] } }): Promise<Preview> {
  return previewSchema.parse(await adminSend(`${BASE}/feeds/${id}/preview`, "POST", input))
}

export async function importFile(feedId: string, rawObjectId: string): Promise<Run & { alreadyProcessedRunId: string | null }> {
  return runSchema.extend({ alreadyProcessedRunId: z.string().nullable() }).parse(await adminSend(`${BASE}/feeds/${feedId}/import`, "POST", { rawObjectId }))
}

export type RunListParams = ListParams & { sourceId?: string; feedId?: string; status: RunStatus[]; triggerKind: RunTriggerKind[]; createdAt: { from?: string; to?: string } }

export async function fetchRunsPage(params: RunListParams): Promise<PageResult<RunListItem>> {
  const { createdAt, ...rest } = params
  return pageResultSchema(runListItemSchema).parse(await adminGet(`${BASE}/runs${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`))
}

export type AuditEventListParams = ListParams & { sourceId?: string; feedId?: string; action: string[]; createdAt: { from?: string; to?: string } }

export async function fetchAuditEventsPage(params: AuditEventListParams): Promise<PageResult<AuditEvent>> {
  const { createdAt, ...rest } = params
  return pageResultSchema(auditEventSchema).parse(await adminGet(`${BASE}/audit-events${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`))
}

export async function fetchRun(id: string): Promise<RunDetail> {
  return runDetailSchema.parse(await adminGet(`${BASE}/runs/${id}`))
}

export async function fetchRejectionsPage(runId: string, params: ListParams & { errorCode: string[] }): Promise<PageResult<Rejection>> {
  return pageResultSchema(rejectionSchema).parse(await adminGet(`${BASE}/runs/${runId}/rejections${toQueryString(params)}`))
}

/** OpenAPI 3.1 da API Push da fonte — gerado na hora pelos feeds e contratos configurados (o integrador importa no Postman/Swagger). */
export async function downloadPushOpenApi(sourceId: string): Promise<{ blob: Blob; filename: string | null }> {
  return adminGetBlob(`${BASE}/sources/${sourceId}/openapi.json`)
}

export async function downloadRejectionsCsv(runId: string): Promise<{ blob: Blob; filename: string | null }> {
  return adminGetBlob(`${BASE}/runs/${runId}/rejections.csv`)
}

export async function reprocessRun(id: string): Promise<Run> {
  return runSchema.parse(await adminSend(`${BASE}/runs/${id}/reprocess`, "POST"))
}

export async function cancelRun(id: string): Promise<Run> {
  return runSchema.parse(await adminSend(`${BASE}/runs/${id}/cancel`, "POST"))
}

export async function fetchLineage(entityType: string, entityId: string): Promise<LineageEntry[]> {
  return z.array(lineageEntrySchema).parse(await adminGet(`${BASE}/lineage${toQueryString({ entityType, entityId })}`))
}
