import { Router } from "express"
import multer from "multer"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { dateParam, listParam, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { DATA_CONTRACTS, dependencyGraph, findDataContract } from "../domain/contract-registry.js"
import { DATA_RECORD_ERROR_CODES, DATA_RUN_ERROR_CODES, describeErrorCode } from "../domain/error-codes.js"
import { RUN_STATUSES, RUN_TRIGGER_KINDS } from "../domain/run-status.js"
import { feedConnectorConfigSchema, fileFormatSchema, SOURCE_KINDS } from "../domain/source-config.js"
import { inferFormatFromFilename, parseFileBatch } from "../application/connectors/file-connector.js"
import { listSftpFiles } from "../application/connectors/sftp-connector.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, deleteFeed, draftFeed, fetchSample, previewMapping, setFeedStatus, updateFeed } from "../application/feed-service.js"
import { buildOverview, buildQualityReport, lineageOf, listSourceSummaries } from "../application/overview-service.js"
import { listFeedsOfSource, requireFeed, requireRun, requireSource, SELECT_RUN } from "../application/records.js"
import { cancelQueuedRun, enqueueRun, kickWorker, requestManualSync, requestReprocess, resetFeedCheckpoint } from "../application/run-service.js"
import { createPushToken, createSource, deleteSource, describeSource, listPushTokens, revokePushToken, rotatePushToken, rotateSourceSecrets, setSourceStatus, testDatabaseDraft, testSourceConnection, updateSource } from "../application/source-service.js"
import { describeDatabaseObject, listDatabaseObjects } from "../application/connectors/database-connector.js"
import { DataRunError } from "../domain/error-codes.js"
import { suggestMapping } from "../domain/mapping.js"
import { multerLimits } from "../../../shared/infrastructure/zip-guard.js"

/**
 * Rotas administrativas da Central de Dados — `/api/v1/admin/data-hub`. Protegidas por
 * requireAuth + requireRole(ADMIN) no app; toda leitura/escrita é escopada pela organização da
 * sessão (nunca por id vindo do browser). Segredos nunca são serializados.
 */
const upload = multer({ storage: multer.memoryStorage(), limits: multerLimits(50 * 1024 * 1024) })

const statusActionSchema = z.object({ action: z.enum(["ACTIVATE", "PAUSE", "RESUME"]) })
const sampleRequestSchema = z.object({ connectorConfig: feedConnectorConfigSchema, contractKey: z.string().min(1), rawObjectId: z.string().uuid().nullable().optional() })
const previewRequestSchema = z.object({
  contractKey: z.string().min(1),
  mapping: z.unknown(),
  sample: z.object({ columns: z.array(z.string()), records: z.array(z.record(z.string(), z.unknown())) }),
})
const runsQuerySchema = z.object({
  search: searchParam,
  sourceId: z.string().uuid().optional(),
  feedId: z.string().uuid().optional(),
  status: listParam(z.enum(RUN_STATUSES)),
  triggerKind: listParam(z.enum(RUN_TRIGGER_KINDS)),
  createdFrom: dateParam,
  createdTo: dateParam,
})
const rejectionsQuerySchema = z.object({ errorCode: listParam(z.string()), search: searchParam })

/** Erro de leitura do banco externo numa rota síncrona (descoberta/colunas) vira resposta 422 com o código estável. */
async function readingExternal<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof DataRunError) throw new DomainError(error.message, error.code, 422)
    throw error
  }
}

async function requireDatabaseSource(db: Database, organizationId: string, sourceId: string) {
  const source = await requireSource(db, organizationId, sourceId)
  if (source.kind !== "DATABASE") throw new DomainError("Esta fonte não é um banco de dados externo.", "DATA_FEED_CONNECTOR_MISMATCH", 422)
  return source
}

export function createDataHubRouter(db: Database, contextOverrides: Partial<Omit<DataHubContext, "db">> = {}) {
  const ctx = createDataHubContext(db, contextOverrides)
  const router = Router()
  const org = (request: { user?: { organizationId: string } }) => request.user!.organizationId
  const actor = (request: { user?: { personId: string } }) => request.user?.personId ?? null

  // ---- Banco de dados externo (descoberta e teste — zero escrita) --------------------------
  /** Testa uma conexão ANTES de salvar: nada é gravado (nem fonte, nem senha); só uma linha de auditoria sem segredo. */
  router.post("/database/test", async (request, response) => {
    response.json({ data: await testDatabaseDraft(ctx, org(request), actor(request), request.body) })
  })

  router.get("/sources/:id/database/objects", async (request, response) => {
    const source = await requireDatabaseSource(db, org(request), String(request.params.id))
    const query = z.object({ search: z.string().max(128).optional() }).parse(request.query)
    response.json({ data: await readingExternal(() => listDatabaseObjects(ctx, source, query.search ?? null)) })
  })

  router.get("/sources/:id/database/columns", async (request, response) => {
    const source = await requireDatabaseSource(db, org(request), String(request.params.id))
    const query = z.object({ schema: z.string().min(1).max(128), name: z.string().min(1).max(128) }).parse(request.query)
    response.json({ data: await readingExternal(() => describeDatabaseObject(ctx, source, { schema: query.schema, name: query.name })) })
  })

  // ---- Visão geral / qualidade / contratos ------------------------------------------------
  router.get("/overview", async (request, response) => {
    response.json({ data: await buildOverview(ctx, org(request)) })
  })

  router.get("/quality", async (request, response) => {
    response.json({ data: await buildQualityReport(ctx, org(request)) })
  })

  router.get("/contracts", (_request, response) => {
    response.json({
      data: {
        contracts: DATA_CONTRACTS.map((contract) => ({ ...contract, validateRecord: undefined })),
        dependencies: dependencyGraph(),
        errorCodes: { run: Object.entries(DATA_RUN_ERROR_CODES).map(([code, label]) => ({ code, label })), record: Object.entries(DATA_RECORD_ERROR_CODES).map(([code, label]) => ({ code, label })) },
        sourceKinds: SOURCE_KINDS,
      },
    })
  })

  router.get("/contracts/:key", (request, response) => {
    const contract = findDataContract(String(request.params.key))
    if (!contract) throw new DomainError("Contrato não encontrado.", "DATA_CONTRACT_UNKNOWN", 404)
    response.json({ data: { ...contract, validateRecord: undefined, pushPayloadExample: { records: contract.examples } } })
  })

  router.get("/lineage", async (request, response) => {
    const query = z.object({ entityType: z.string().min(1), entityId: z.string().uuid() }).parse(request.query)
    response.json({ data: await lineageOf(ctx, org(request), query.entityType, query.entityId) })
  })

  // ---- Fontes -----------------------------------------------------------------------------
  router.get("/sources", async (request, response) => {
    response.json({ data: await listSourceSummaries(ctx, org(request)) })
  })

  router.post("/sources", async (request, response) => {
    response.status(201).json({ data: await createSource(ctx, org(request), actor(request), request.body) })
  })

  router.get("/sources/:id", async (request, response) => {
    const summaries = await listSourceSummaries(ctx, org(request))
    const summary = summaries.find((source) => source.id === request.params.id)
    if (!summary) throw new DomainError("Fonte não encontrada.", "DATA_SOURCE_NOT_FOUND", 404)
    const view = await describeSource(ctx, summary)
    response.json({ data: { ...summary, secrets: view.secrets, tokens: summary.kind === "API_PUSH" ? await listPushTokens(ctx, org(request), summary.id) : [] } })
  })

  router.patch("/sources/:id", async (request, response) => {
    response.json({ data: await updateSource(ctx, org(request), actor(request), String(request.params.id), request.body) })
  })

  router.delete("/sources/:id", async (request, response) => {
    await deleteSource(ctx, org(request), actor(request), String(request.params.id))
    response.status(204).end()
  })

  router.post("/sources/:id/test-connection", async (request, response) => {
    response.json({ data: await testSourceConnection(ctx, org(request), actor(request), String(request.params.id)) })
  })

  router.post("/sources/:id/status", async (request, response) => {
    const { action } = statusActionSchema.parse(request.body)
    response.json({ data: await setSourceStatus(ctx, org(request), actor(request), String(request.params.id), action) })
  })

  router.post("/sources/:id/secrets", async (request, response) => {
    response.json({ data: await rotateSourceSecrets(ctx, org(request), actor(request), String(request.params.id), request.body) })
  })

  router.get("/sources/:id/tokens", async (request, response) => {
    await requireSource(db, org(request), String(request.params.id))
    response.json({ data: await listPushTokens(ctx, org(request), String(request.params.id)) })
  })

  router.post("/sources/:id/tokens", async (request, response) => {
    const input = z.object({ label: z.string().trim().min(2).max(80), feedId: z.string().uuid().nullable().optional() }).parse(request.body)
    const created = await createPushToken(ctx, org(request), actor(request), String(request.params.id), { label: input.label, feedId: input.feedId ?? null })
    // O segredo aparece SÓ nesta resposta.
    response.status(201).json({ data: { ...created.view, token: created.token } })
  })

  router.post("/sources/:id/tokens/:tokenId/revoke", async (request, response) => {
    await revokePushToken(ctx, org(request), actor(request), String(request.params.id), String(request.params.tokenId))
    response.status(204).end()
  })

  router.post("/sources/:id/tokens/:tokenId/rotate", async (request, response) => {
    const rotated = await rotatePushToken(ctx, org(request), actor(request), String(request.params.id), String(request.params.tokenId))
    response.status(201).json({ data: { ...rotated.view, token: rotated.token } })
  })

  // ---- Amostra / preview (zero efeitos) ----------------------------------------------------
  router.post("/sources/:id/sample", async (request, response) => {
    const source = await requireSource(db, org(request), String(request.params.id))
    const input = sampleRequestSchema.parse(request.body)
    response.json({ data: await fetchSample(ctx, org(request), { source, feed: null, connectorConfig: input.connectorConfig, contractKey: input.contractKey, rawObjectId: input.rawObjectId ?? null }) })
  })

  router.post("/sources/:id/preview", async (request, response) => {
    const source = await requireSource(db, org(request), String(request.params.id))
    const input = previewRequestSchema.parse(request.body)
    response.json({ data: await previewMapping(ctx, org(request), { source, feed: null, contractKey: input.contractKey, mapping: input.mapping, sample: input.sample }) })
  })

  router.post("/sources/:id/sftp-files", async (request, response) => {
    const source = await requireSource(db, org(request), String(request.params.id))
    const input = z.object({ connectorConfig: feedConnectorConfigSchema }).parse(request.body)
    response.json({ data: await listSftpFiles(ctx, source, draftFeed(source, input.connectorConfig, "EMPLOYEES")) })
  })

  /** Upload de arquivo (CSV/XLSX): retém como objeto bruto e devolve colunas + amostra + abas. Nada é aplicado. */
  router.post("/uploads", upload.single("file"), async (request, response) => {
    const file = request.file
    if (!file) throw new DomainError("Envie um arquivo no campo 'file'.", "DATA_FILE_INVALID", 422)
    const format = (request.body?.format ? fileFormatSchema.parse(String(request.body.format).toUpperCase()) : null) ?? inferFormatFromFilename(file.originalname)
    if (!format) throw new DomainError("Só arquivos .csv e .xlsx são aceitos.", "DATA_FILE_INVALID", 422)
    const sourceId = typeof request.body?.sourceId === "string" ? request.body.sourceId : null
    if (sourceId) await requireSource(db, org(request), sourceId)
    const raw = await ctx.rawObjects.put({ organizationId: org(request), sourceId, feedId: null, filename: file.originalname, contentType: format === "XLSX" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv", content: new Uint8Array(file.buffer) })
    const csv = { encoding: (request.body?.encoding as "utf-8" | "windows-1252" | "latin1" | undefined) ?? "utf-8", delimiter: (request.body?.delimiter as "auto" | "," | ";" | "\t" | "|" | undefined) ?? "auto", hasHeader: true, skipRows: 0 }
    const excel = { sheet: typeof request.body?.sheet === "string" && request.body.sheet ? request.body.sheet : undefined, hasHeader: true, skipRows: 0 }
    const batch = await parseFileBatch({ format, csv, excel: excel.sheet ? excel : { hasHeader: true, skipRows: 0 } }, new Uint8Array(file.buffer), 20)
    const contractKey = typeof request.body?.contractKey === "string" ? request.body.contractKey : null
    const contract = contractKey ? findDataContract(contractKey) : null
    response.status(201).json({
      data: {
        rawObjectId: raw.id,
        filename: file.originalname,
        byteSize: raw.byteSize,
        checksumSha256: raw.checksumSha256,
        format,
        columns: batch.columns,
        records: batch.records,
        totalRecords: batch.totalRecords,
        detail: batch.detail,
        sheets: batch.sheets ?? [],
        suggestedMapping: contract ? suggestMapping(contract, batch.columns, batch.records) : null,
      },
    })
  })

  // ---- Feeds ------------------------------------------------------------------------------
  router.get("/sources/:id/feeds", async (request, response) => {
    await requireSource(db, org(request), String(request.params.id))
    response.json({ data: await listFeedsOfSource(db, org(request), String(request.params.id)) })
  })

  router.post("/sources/:id/feeds", async (request, response) => {
    response.status(201).json({ data: await createFeed(ctx, org(request), actor(request), String(request.params.id), request.body) })
  })

  router.get("/feeds/:id", async (request, response) => {
    const feed = await requireFeed(db, org(request), String(request.params.id))
    const summaries = await listSourceSummaries(ctx, org(request))
    const summary = summaries.flatMap((source) => source.feeds.map((entry) => ({ entry, source }))).find(({ entry }) => entry.id === feed.id)
    response.json({ data: { ...feed, freshness: summary?.entry.freshness ?? "NEVER", contractLabel: summary?.entry.contractLabel ?? feed.contractKey, lastRun: summary?.entry.lastRun ?? null, source: summary ? { id: summary.source.id, name: summary.source.name, kind: summary.source.kind, publicId: summary.source.publicId, status: summary.source.status } : null } })
  })

  router.patch("/feeds/:id", async (request, response) => {
    response.json({ data: await updateFeed(ctx, org(request), actor(request), String(request.params.id), request.body) })
  })

  router.delete("/feeds/:id", async (request, response) => {
    await deleteFeed(ctx, org(request), actor(request), String(request.params.id))
    response.status(204).end()
  })

  router.post("/feeds/:id/status", async (request, response) => {
    const { action } = statusActionSchema.parse(request.body)
    response.json({ data: await setFeedStatus(ctx, org(request), actor(request), String(request.params.id), action) })
  })

  router.post("/feeds/:id/sync", async (request, response) => {
    const run = await requestManualSync(ctx, org(request), String(request.params.id), actor(request))
    kickWorker(ctx)
    response.status(202).json({ data: run })
  })

  /** Reinicia a leitura (checkpoint) de um conjunto de banco externo do começo. Nada é apagado; a próxima carga relê tudo (idempotente). */
  router.post("/feeds/:id/checkpoint/reset", async (request, response) => {
    response.json({ data: await resetFeedCheckpoint(ctx, org(request), String(request.params.id), actor(request)) })
  })

  router.post("/feeds/:id/sample", async (request, response) => {
    const feed = await requireFeed(db, org(request), String(request.params.id))
    const source = await requireSource(db, org(request), feed.sourceId)
    const input = z.object({ rawObjectId: z.string().uuid().nullable().optional() }).parse(request.body ?? {})
    response.json({ data: await fetchSample(ctx, org(request), { source, feed, connectorConfig: feed.connectorConfig, contractKey: feed.contractKey, rawObjectId: input.rawObjectId ?? null }) })
  })

  router.post("/feeds/:id/preview", async (request, response) => {
    const feed = await requireFeed(db, org(request), String(request.params.id))
    const source = await requireSource(db, org(request), feed.sourceId)
    const input = previewRequestSchema.partial({ contractKey: true }).parse(request.body)
    response.json({ data: await previewMapping(ctx, org(request), { source, feed, contractKey: input.contractKey ?? feed.contractKey, mapping: input.mapping ?? feed.mapping, sample: input.sample }) })
  })

  /** Importação de arquivo já enviado (`/uploads`) por um feed de arquivo: cria o Run e processa fora do request. */
  router.post("/feeds/:id/import", async (request, response) => {
    const feed = await requireFeed(db, org(request), String(request.params.id))
    const source = await requireSource(db, org(request), feed.sourceId)
    if (source.kind !== "FILE_UPLOAD") throw new DomainError("Só feeds de importação manual aceitam arquivo.", "DATA_FEED_CONNECTOR_MISMATCH", 422)
    const input = z.object({ rawObjectId: z.string().uuid() }).parse(request.body)
    const raw = await ctx.rawObjects.get(input.rawObjectId, org(request))
    if (!raw) throw new DomainError("O arquivo enviado expirou — envie novamente.", "DATA_RAW_EXPIRED", 422)
    if (feed.status === "DRAFT") await setFeedStatus(ctx, org(request), actor(request), feed.id, "ACTIVATE")
    const duplicate = await db.query<{ id: string }>(`select p.run_id id from data_processed_files p where p.feed_id = $1 and p.checksum_sha256 = $2`, [feed.id, raw.meta.checksumSha256])
    const { run } = await enqueueRun(ctx, { organizationId: org(request), feed: await requireFeed(db, org(request), feed.id), triggerKind: "FILE_UPLOAD", requestedBy: actor(request), rawObjectId: raw.meta.id, idempotencyKey: `file:${raw.meta.checksumSha256}` })
    await db.query(`insert into data_processed_files (organization_id, feed_id, remote_path, checksum_sha256, byte_size, run_id) values ($1, $2, $3, $4, $5, $6) on conflict (feed_id, checksum_sha256) do nothing`, [org(request), feed.id, raw.meta.filename ?? "upload", raw.meta.checksumSha256, raw.meta.byteSize, run.id])
    kickWorker(ctx)
    response.status(202).json({ data: { ...run, alreadyProcessedRunId: duplicate.rows[0]?.id ?? null } })
  })

  // ---- Runs -------------------------------------------------------------------------------
  const SELECT_RUNS_LIST = `${SELECT_RUN.replace("from data_ingestion_runs r", "")}, f.name "feedName", s.name "sourceName", s.kind "sourceKind"
    from data_ingestion_runs r join data_feeds f on f.id = r.feed_id join data_sources s on s.id = r.source_id where r.organization_id = $1`

  router.get("/runs", async (request, response) => {
    const query = runsQuerySchema.parse(request.query)
    const filter = new SqlFilter([org(request)])
      .search(query.search, ['q."feedName"', 'q."sourceName"', 'q."contractKey"'])
      .equals('q."sourceId"', query.sourceId)
      .equals('q."feedId"', query.feedId)
      .in("q.status", query.status)
      .in('q."triggerKind"', query.triggerKind)
      .dateRange('q."createdAt"', query.createdFrom, query.createdTo)
    const data = await respondList(db, { page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 20 }, { select: SELECT_RUNS_LIST, filter, orderBy: 'q."createdAt" desc' })
    response.json({ data })
  })

  router.get("/runs/:id", async (request, response) => {
    const run = await requireRun(db, org(request), String(request.params.id))
    const feed = await requireFeed(db, org(request), run.feedId).catch(() => null)
    const source = await requireSource(db, org(request), run.sourceId).catch(() => null)
    const summary = await db.query<{ code: string; count: number }>(`select error_code code, count(*)::int count from data_ingestion_rejections where run_id = $1 group by 1 order by 2 desc`, [run.id])
    const rawAvailable = run.rawObjectId ? (await db.query(`select 1 from data_raw_objects where id = $1`, [run.rawObjectId])).rowCount === 1 : false
    response.json({
      data: {
        ...run,
        feedName: feed?.name ?? null,
        feedKey: feed?.feedKey ?? null,
        sourceName: source?.name ?? null,
        sourceKind: source?.kind ?? null,
        errorLabel: run.errorCode ? describeErrorCode(run.errorCode) : null,
        rejectionSummary: summary.rows.map((row) => ({ code: row.code, label: describeErrorCode(row.code), count: row.count })),
        rawAvailable,
      },
    })
  })

  router.get("/runs/:id/rejections", async (request, response) => {
    const run = await requireRun(db, org(request), String(request.params.id))
    const query = rejectionsQuerySchema.parse(request.query)
    const filter = new SqlFilter([run.id]).in('q."errorCode"', query.errorCode).search(query.search, ['q."sourceRecordKey"', "q.message", "q.field"])
    const select = `select id, record_number "recordNumber", source_record_key "sourceRecordKey", error_code "errorCode", field, message, created_at "createdAt" from data_ingestion_rejections where run_id = $1`
    const data = await respondList(db, { page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 20 }, { select, filter, orderBy: 'q."recordNumber"' })
    response.json({ data })
  })

  /** Exportação CSV dos erros (sem segredo, sem payload — só chave do registro, campo, código e mensagem). */
  router.get("/runs/:id/rejections.csv", async (request, response) => {
    const run = await requireRun(db, org(request), String(request.params.id))
    const rows = await db.query<{ record_number: number; source_record_key: string | null; error_code: string; field: string | null; message: string }>(
      `select record_number, source_record_key, error_code, field, message from data_ingestion_rejections where run_id = $1 order by record_number limit 50000`,
      [run.id],
    )
    // Chave e mensagem vêm do arquivo/payload do cliente: fórmula de planilha neutralizada (achado I-F12).
    const escape = (value: string | number | null) => {
      const text = String(value ?? "")
      return `"${(typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
    }
    const lines = ["linha;chave_registro;codigo;campo;mensagem", ...rows.rows.map((row) => [row.record_number, row.source_record_key, row.error_code, row.field, row.message].map(escape).join(";"))]
    response.setHeader("content-type", "text/csv; charset=utf-8")
    response.setHeader("content-disposition", `attachment; filename="rejeicoes-${run.id.slice(0, 8)}.csv"`)
    response.send(`\uFEFF${lines.join("\r\n")}`)
  })

  router.post("/runs/:id/reprocess", async (request, response) => {
    const run = await requestReprocess(ctx, org(request), String(request.params.id), actor(request))
    kickWorker(ctx)
    response.status(202).json({ data: run })
  })

  router.post("/runs/:id/cancel", async (request, response) => {
    response.json({ data: await cancelQueuedRun(ctx, org(request), String(request.params.id), actor(request)) })
  })

  return router
}
