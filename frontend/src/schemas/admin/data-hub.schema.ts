import { z } from "zod"

import { cadenceSchema } from "@/schemas/admin/data-hub-cadence.schema"
import { workScheduleHorizonSchema } from "@/schemas/admin/operational-calendar.schema"

export { cadenceLabel, cadenceProblem, cadencePreviewSchema, cadenceSaveProblem, cadenceSchema, type Cadence, type CadencePreview } from "@/schemas/admin/data-hub-cadence.schema"

/**
 * Contrato do frontend com `/api/v1/admin/data-hub` — espelha os tipos do backend
 * (modules/data-hub). Rótulos de UI ficam aqui (uma fonte para telas e Wiki).
 */
export const SOURCE_KINDS = ["FILE_UPLOAD", "DATABASE", "API_PULL", "API_PUSH", "SFTP"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  FILE_UPLOAD: "Importação manual",
  DATABASE: "Banco de dados",
  API_PULL: "API Pull",
  API_PUSH: "API Push",
  SFTP: "SFTP",
}
export const SOURCE_KIND_DESCRIPTIONS: Record<SourceKind, string> = {
  FILE_UPLOAD: "Você envia arquivos CSV ou Excel pela tela. Ideal para cargas pontuais e para começar.",
  DATABASE: "A INIA lê tabelas ou visões do banco do cliente (SQL Server, PostgreSQL, MariaDB ou MySQL) com um usuário somente leitura.",
  API_PULL: "A INIA consulta a API do cliente na cadência configurada (com paginação e checkpoint).",
  API_PUSH: "O cliente envia os dados para um endpoint da INIA, com token e chave de idempotência.",
  SFTP: "A INIA busca arquivos novos no servidor SFTP do cliente, por padrão de nome.",
}
/** Fontes que a INIA consulta por conta própria (cadência, "Sincronizar agora", saúde da conexão). */
export const REMOTE_SOURCE_KINDS: readonly SourceKind[] = ["API_PULL", "SFTP", "DATABASE"]

// ---------------------------------------------------------------------------------------------
// Bancos de dados EXTERNOS (do cliente) — espelha backend/modules/data-hub/domain/database/*.
// Nunca é o banco interno da INIA.
// ---------------------------------------------------------------------------------------------
export const DATABASE_ENGINES = ["SQLSERVER", "POSTGRESQL", "MARIADB", "MYSQL"] as const
export type DatabaseEngine = (typeof DATABASE_ENGINES)[number]
export const DATABASE_ENGINE_LABELS: Record<DatabaseEngine, string> = { SQLSERVER: "SQL Server", POSTGRESQL: "PostgreSQL", MARIADB: "MariaDB", MYSQL: "MySQL" }
export const DATABASE_ENGINE_HINTS: Record<DatabaseEngine, string> = {
  SQLSERVER: "Microsoft SQL Server 2016 ou mais novo, inclusive Azure SQL.",
  POSTGRESQL: "PostgreSQL 12 ou mais novo, inclusive serviços gerenciados.",
  MARIADB: "MariaDB 10.5 ou mais novo.",
  MYSQL: "MySQL 8.0 ou mais novo.",
}
export const DEFAULT_DATABASE_PORTS: Record<DatabaseEngine, number> = { SQLSERVER: 1433, POSTGRESQL: 5432, MARIADB: 3306, MYSQL: 3306 }
export const DATABASE_TLS_MODES = ["DISABLED", "PREFERRED", "REQUIRED", "VERIFY_FULL"] as const
export type DatabaseTlsMode = (typeof DATABASE_TLS_MODES)[number]
export const DATABASE_TLS_LABELS: Record<DatabaseTlsMode, string> = {
  DISABLED: "Desligada",
  PREFERRED: "Usar quando o servidor oferecer",
  REQUIRED: "Obrigatória (sem validar certificado)",
  VERIFY_FULL: "Obrigatória e validando o certificado",
}
export const DEFAULT_TLS_MODE: Record<DatabaseEngine, DatabaseTlsMode> = { SQLSERVER: "REQUIRED", POSTGRESQL: "PREFERRED", MARIADB: "PREFERRED", MYSQL: "PREFERRED" }
/** Banco NOVO nasce validando o certificado (auditoria de segurança 17/10/2026, DATA-5); `DEFAULT_TLS_MODE` fica para fontes antigas sem o campo. */
export const NEW_SOURCE_TLS_MODE: DatabaseTlsMode = "VERIFY_FULL"
export function supportedTlsModes(engine: DatabaseEngine): DatabaseTlsMode[] {
  return engine === "SQLSERVER" ? ["DISABLED", "REQUIRED", "VERIFY_FULL"] : [...DATABASE_TLS_MODES]
}
export type DatabaseConfig = {
  engine: DatabaseEngine
  host: string
  port?: number
  database: string
  username: string
  instanceName?: string
  tls?: { mode: DatabaseTlsMode; caCertificate?: string }
  connectTimeoutMs?: number
  queryTimeoutMs?: number
}

export const databaseReportSchema = z.object({
  serverVersion: z.string(),
  engineFound: z.enum(DATABASE_ENGINES),
  engineMismatch: z.string().nullable(),
  tlsActive: z.boolean(),
  readOnlyEnforced: z.boolean(),
  privilegeWarning: z.string().nullable(),
  objectsVisible: z.number(),
})
export type DatabaseReport = z.infer<typeof databaseReportSchema>

export const COLUMN_CATEGORY_LABELS: Record<string, string> = {
  INTEGER: "Número inteiro",
  DECIMAL: "Número decimal",
  FLOAT: "Número aproximado",
  BOOLEAN: "Sim/não",
  DATE: "Data",
  DATETIME: "Data e hora",
  DATETIME_TZ: "Data e hora com fuso",
  TIME: "Hora",
  TEXT: "Texto",
  UUID: "Identificador",
  JSON: "JSON",
  BINARY: "Binário (não importado)",
  OTHER: "Não suportado",
}

export const databaseObjectSummarySchema = z.object({ schema: z.string(), name: z.string(), kind: z.enum(["TABLE", "VIEW"]), estimatedRows: z.number().nullable() })
export type DatabaseObjectSummary = z.infer<typeof databaseObjectSummarySchema>
export const databaseObjectListSchema = z.object({ objects: z.array(databaseObjectSummarySchema), truncated: z.boolean() })
export type DatabaseObjectList = z.infer<typeof databaseObjectListSchema>

export const databaseColumnSchema = z.object({
  name: z.string(),
  nativeType: z.string(),
  category: z.string(),
  nullable: z.boolean(),
  primaryKeyPosition: z.number().nullable(),
  supported: z.boolean(),
  cursorEligible: z.boolean(),
  keyEligible: z.boolean(),
})
export type DatabaseColumn = z.infer<typeof databaseColumnSchema>
export const databaseObjectDescriptionSchema = z.object({ schema: z.string(), name: z.string(), kind: z.enum(["TABLE", "VIEW"]), columns: z.array(databaseColumnSchema), primaryKey: z.array(z.string()) })
export type DatabaseObjectDescription = z.infer<typeof databaseObjectDescriptionSchema>

export type DatabaseSync = { mode: "FULL"; keyColumns: string[] } | { mode: "INCREMENTAL"; cursorColumn: string; keyColumns: string[]; lookbackMinutes: number }
export type DatabaseFeedConfig = { object: { schema: string; name: string; kind: "TABLE" | "VIEW" }; sync: DatabaseSync; batchSize: number; maxRowsPerRun: number }
export const DATABASE_SYNC_MODE_LABELS: Record<DatabaseSync["mode"], string> = { INCREMENTAL: "Incremental (só o que mudou)", FULL: "Leitura completa" }
export const DATABASE_BATCH_SIZE_DEFAULT = 1000
export const DATABASE_MAX_ROWS_PER_RUN_DEFAULT = 50000

/** Posição salva da leitura de um conjunto de banco externo (data_feeds.checkpoint). */
export type DatabaseCheckpoint = { kind: "DATABASE"; mode: DatabaseSync["mode"]; orderColumns: string[]; position: string[] | null; reachedEnd: boolean; updatedAt: string }

export const SOURCE_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ERROR"] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = { DRAFT: "Rascunho", ACTIVE: "Ativa", PAUSED: "Pausada", ERROR: "Erro" }

export const FEED_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "DEGRADED"] as const
export type FeedStatus = (typeof FEED_STATUSES)[number]
export const FEED_STATUS_LABELS: Record<FeedStatus, string> = { DRAFT: "Rascunho", ACTIVE: "Ativo", PAUSED: "Pausado", DEGRADED: "Degradado" }

export const CONNECTION_HEALTHS = ["HEALTHY", "ERROR", "UNKNOWN"] as const
export type ConnectionHealth = (typeof CONNECTION_HEALTHS)[number]
export const CONNECTION_HEALTH_LABELS: Record<ConnectionHealth, string> = { HEALTHY: "Conexão OK", ERROR: "Conexão com erro", UNKNOWN: "Não testada" }

export const FRESHNESS_STATES = ["FRESH", "STALE", "NEVER"] as const
export type FreshnessState = (typeof FRESHNESS_STATES)[number]
export const FRESHNESS_LABELS: Record<FreshnessState, string> = { FRESH: "Atualizado", STALE: "Atrasado", NEVER: "Nunca recebido" }

export const RUN_STATUSES = ["QUEUED", "CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  QUEUED: "Na fila",
  CONNECTING: "Conectando",
  FETCHING: "Baixando",
  PARSING: "Lendo",
  MAPPING: "Mapeando",
  VALIDATING: "Validando",
  APPLYING: "Aplicando",
  COMPLETED: "Concluída",
  PARTIAL: "Parcial",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
}
export const RUN_ACTIVE_STATUSES: RunStatus[] = ["QUEUED", "CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING"]

export const RUN_TRIGGER_KINDS = ["MANUAL", "SCHEDULE", "PUSH", "FILE_UPLOAD", "REPROCESS", "CONTINUATION"] as const
export type RunTriggerKind = (typeof RUN_TRIGGER_KINDS)[number]
export const RUN_TRIGGER_LABELS: Record<RunTriggerKind, string> = { MANUAL: "Sincronização manual", SCHEDULE: "Agendada", PUSH: "Recebida (push)", FILE_UPLOAD: "Importação de arquivo", REPROCESS: "Reprocessamento", CONTINUATION: "Continuação automática" }

export const LOAD_MODES = ["DELTA", "SNAPSHOT"] as const
export type LoadMode = (typeof LOAD_MODES)[number]
export const LOAD_MODE_LABELS: Record<LoadMode, string> = { DELTA: "Delta (só o que veio muda)", SNAPSHOT: "Snapshot (estado completo)" }

export const API_AUTH_KINDS = ["NONE", "BEARER", "API_KEY", "BASIC", "OAUTH2_CLIENT_CREDENTIALS"] as const
export type ApiAuthKind = (typeof API_AUTH_KINDS)[number]
export const API_AUTH_LABELS: Record<ApiAuthKind, string> = { NONE: "Sem autenticação", BEARER: "Bearer Token", API_KEY: "API Key (header)", BASIC: "Basic Auth", OAUTH2_CLIENT_CREDENTIALS: "OAuth2 Client Credentials" }

export const TRANSFORM_KINDS = ["TRIM", "UPPERCASE", "LOWERCASE", "PARSE_DATE", "PARSE_DECIMAL", "BOOLEAN_MAP", "DEFAULT", "CONSTANT", "CODE_MAP"] as const
export type TransformKind = (typeof TRANSFORM_KINDS)[number]
export const TRANSFORM_LABELS: Record<TransformKind, string> = {
  TRIM: "Remover espaços",
  UPPERCASE: "Maiúsculas",
  LOWERCASE: "Minúsculas",
  PARSE_DATE: "Interpretar data",
  PARSE_DECIMAL: "Interpretar decimal",
  BOOLEAN_MAP: "Mapear sim/não",
  DEFAULT: "Padrão quando vazio",
  CONSTANT: "Valor fixo",
  CODE_MAP: "Mapear códigos",
}
export const DATE_FORMATS = ["ISO", "dd/MM/yyyy", "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy HH:mm", "MM/dd/yyyy", "yyyyMMdd", "yyyy-MM-dd HH:mm:ss"] as const

/** DISPONIBILIDADE ESPERADA (migration 069): "o dado de D chega em D+lagDays até HH:MM" — distinta de cadência/freshness. */
export const availabilityPolicySchema = z.object({ lagDays: z.number().int().min(0).max(14), availableByLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })
export type AvailabilityPolicy = z.infer<typeof availabilityPolicySchema>

export function availabilityPolicyLabel(policy: AvailabilityPolicy | null | undefined): string {
  if (!policy) return "SLA não configurado"
  return policy.lagDays === 0 ? `No mesmo dia até ${policy.availableByLocalTime}` : `D-${policy.lagDays} até ${policy.availableByLocalTime}`
}

/** Contratos para os quais a disponibilidade esperada importa (evidência de produção e situação funcional). */
export const AVAILABILITY_RELEVANT_CONTRACTS = ["INDICATOR_MEASUREMENTS", "INTERACTIONS", "EMPLOYEES", "EMPLOYEE_ABSENCES"] as const

export const transformSchema = z.object({ kind: z.enum(TRANSFORM_KINDS) }).passthrough()
export type Transform = { kind: TransformKind } & Record<string, unknown>

export const fieldMappingSchema = z.object({ target: z.string(), source: z.string().nullable(), transforms: z.array(transformSchema).default([]) })
export type FieldMapping = { target: string; source: string | null; transforms: Transform[] }
export const feedMappingSchema = z.object({ fields: z.array(fieldMappingSchema).default([]), timeZone: z.string().optional() })
export type FeedMapping = { fields: FieldMapping[]; timeZone?: string }

export const runSummarySchema = z.object({
  id: z.string(),
  status: z.enum(RUN_STATUSES),
  triggerKind: z.enum(RUN_TRIGGER_KINDS),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  recordsReceived: z.number(),
  recordsInserted: z.number(),
  recordsUpdated: z.number(),
  recordsRejected: z.number(),
  errorCode: z.string().nullable(),
})
export type RunSummary = z.infer<typeof runSummarySchema>

export const feedSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  feedKey: z.string(),
  name: z.string(),
  contractKey: z.string(),
  contractVersion: z.number(),
  connectorConfig: z.record(z.string(), z.unknown()),
  mapping: feedMappingSchema,
  loadMode: z.enum(LOAD_MODES),
  cadence: cadenceSchema,
  expectedIntervalMinutes: z.number().nullable(),
  status: z.enum(FEED_STATUSES),
  authoritative: z.boolean(),
  failOnAnyRejection: z.boolean(),
  sourceNamespace: z.string().nullable(),
  availabilityPolicy: availabilityPolicySchema.nullable().optional().default(null),
  schemaFingerprint: z.object({ columns: z.array(z.string()), hash: z.string(), observedAt: z.string() }).nullable(),
  schemaChangedAt: z.string().nullable(),
  checkpoint: z.record(z.string(), z.unknown()).nullable(),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastDataAt: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  nextSyncAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Feed = z.infer<typeof feedSchema>

export const feedSummarySchema = feedSchema.extend({ freshness: z.enum(FRESHNESS_STATES), contractLabel: z.string(), lastRun: runSummarySchema.nullable() })
export type FeedSummary = z.infer<typeof feedSummarySchema>

export const sourceSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(SOURCE_KINDS),
  status: z.enum(SOURCE_STATUSES),
  config: z.record(z.string(), z.unknown()),
  connectionHealth: z.enum(CONNECTION_HEALTHS),
  connectionCheckedAt: z.string().nullable(),
  connectionError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Source = z.infer<typeof sourceSchema>

export const sourceSummarySchema = sourceSchema.extend({
  feedCount: z.number(),
  activeFeedCount: z.number(),
  freshness: z.enum(FRESHNESS_STATES),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastDataAt: z.string().nullable(),
  nextSyncAt: z.string().nullable(),
  lastRecordsReceived: z.number().nullable(),
  lastRecordsRejected: z.number().nullable(),
  feeds: z.array(feedSummarySchema),
})
export type SourceSummary = z.infer<typeof sourceSummarySchema>

export const pushTokenSchema = z.object({
  id: z.string(),
  label: z.string(),
  tokenPrefix: z.string(),
  feedId: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** Depois desta data o token é recusado. `null` = sem validade. */
  expiresAt: z.string().nullable().default(null),
  /** IPs/redes de onde o token é aceito. `null` = qualquer origem. */
  allowedNetworks: z.array(z.string()).nullable().default(null),
  token: z.string().optional(),
})
export type PushToken = z.infer<typeof pushTokenSchema>

/** Se esta pessoa, nesta sessão, pode configurar a fonte agora. `fields` = o que precisa digitar para liberar. */
export const configAccessSchema = z.object({ required: z.boolean(), unlocked: z.boolean(), expiresAt: z.string().nullable(), fields: z.array(z.string()) })
export type ConfigAccess = z.infer<typeof configAccessSchema>

export const sourceDetailSchema = sourceSummarySchema.extend({
  secrets: z.array(z.object({ purpose: z.string(), createdAt: z.string(), rotatedAt: z.string().nullable() })),
  tokens: z.array(pushTokenSchema),
  /** API Pull com credencial por http:// — a tela avisa enquanto estiver assim. */
  transportWarning: z.string().nullable().default(null),
  configAccess: configAccessSchema,
  createdByName: z.string().nullable(),
  updatedByName: z.string().nullable(),
  lastChangedAt: z.string().nullable(),
})
export type SourceDetail = z.infer<typeof sourceDetailSchema>

export const runStageSchema = z.object({ stage: z.enum(RUN_STATUSES), startedAt: z.string(), finishedAt: z.string().nullable(), detail: z.string().nullable() })

export const runSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  feedId: z.string(),
  contractKey: z.string(),
  contractVersion: z.number(),
  triggerKind: z.enum(RUN_TRIGGER_KINDS),
  status: z.enum(RUN_STATUSES),
  stages: z.array(runStageSchema),
  rawObjectId: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  reprocessOfRunId: z.string().nullable(),
  attempts: z.number(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  bytes: z.number().nullable(),
  recordsReceived: z.number(),
  recordsParsed: z.number(),
  recordsValid: z.number(),
  recordsRejected: z.number(),
  recordsInserted: z.number(),
  recordsUpdated: z.number(),
  recordsUnchanged: z.number(),
  recordsDeactivated: z.number(),
  errorCount: z.number(),
  /** Avisos não bloqueantes (registro aplicado com ressalva) — separado de erros e rejeitados. Cargas antigas: 0. */
  warningCount: z.number().default(0),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  businessMaxEventTime: z.string().nullable(),
  checkpointBefore: z.record(z.string(), z.unknown()).nullable(),
  checkpointAfter: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
})
export type Run = z.infer<typeof runSchema>

export const runListItemSchema = runSchema.extend({ feedName: z.string(), sourceName: z.string(), sourceKind: z.enum(SOURCE_KINDS) })
export type RunListItem = z.infer<typeof runListItemSchema>

export const runDetailSchema = runSchema.extend({
  feedName: z.string().nullable(),
  feedKey: z.string().nullable(),
  sourceName: z.string().nullable(),
  sourceKind: z.enum(SOURCE_KINDS).nullable(),
  errorLabel: z.string().nullable(),
  rejectionSummary: z.array(z.object({ code: z.string(), label: z.string(), count: z.number() })),
  rawAvailable: z.boolean(),
})
export type RunDetail = z.infer<typeof runDetailSchema>

export const rejectionSchema = z.object({ id: z.string(), recordNumber: z.number(), sourceRecordKey: z.string().nullable(), errorCode: z.string(), field: z.string().nullable(), message: z.string(), createdAt: z.string() })
export type Rejection = z.infer<typeof rejectionSchema>

export const contractFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean(),
  description: z.string(),
  example: z.union([z.string(), z.number(), z.boolean()]),
  enumValues: z.array(z.string()).optional(),
  maxLength: z.number().optional(),
  identity: z.boolean().optional(),
})
export type ContractField = z.infer<typeof contractFieldSchema>

export const contractSchema = z.object({
  key: z.string(),
  version: z.number(),
  label: z.string(),
  description: z.string(),
  category: z.enum(["MASTER", "EVENT", "PERFORMANCE"]),
  targetEntity: z.string(),
  fields: z.array(contractFieldSchema),
  naturalKey: z.array(z.string()),
  atLeastOne: z.array(z.array(z.string())).optional(),
  dependencies: z.array(z.string()),
  writeSemantics: z.enum(["UPSERT", "IDEMPOTENT_EVENT"]),
  writePolicy: z.enum(["PARTIAL_ALLOWED", "ATOMIC"]),
  businessTimeField: z.string().nullable(),
  examples: z.array(z.record(z.string(), z.unknown())),
})
export type DataContract = z.infer<typeof contractSchema>

export const CONTRACT_CATEGORY_LABELS: Record<DataContract["category"], string> = { MASTER: "Dado mestre", EVENT: "Evento / medição", PERFORMANCE: "Performance" }
export const WRITE_POLICY_LABELS: Record<DataContract["writePolicy"], string> = { PARTIAL_ALLOWED: "Parcial: válidos entram, inválidos vão para a quarentena", ATOMIC: "Atômico: qualquer rejeição impede a carga inteira" }
export const WRITE_SEMANTICS_LABELS: Record<DataContract["writeSemantics"], string> = { UPSERT: "Upsert pela chave natural (ausência nunca apaga)", IDEMPOTENT_EVENT: "Evento idempotente (mesma chave substitui, nunca duplica)" }
export const FIELD_TYPE_LABELS: Record<string, string> = { STRING: "Texto", INTEGER: "Inteiro", DECIMAL: "Decimal", BOOLEAN: "Sim/Não", DATE: "Data", DATETIME: "Data e hora", TIME: "Hora", MONTH: "Competência (AAAA-MM)", ENUM: "Opção" }

export const contractsCatalogSchema = z.object({
  contracts: z.array(contractSchema),
  dependencies: z.array(z.object({ key: z.string(), dependsOn: z.array(z.string()) })),
  errorCodes: z.object({ run: z.array(z.object({ code: z.string(), label: z.string() })), record: z.array(z.object({ code: z.string(), label: z.string() })) }),
})
export type ContractsCatalog = z.infer<typeof contractsCatalogSchema>

export const dataMapEntrySchema = z.object({
  contractKey: z.string(),
  label: z.string(),
  category: z.string(),
  targetEntity: z.string(),
  /** Contratos que alimentam a mesma camada canônica (Ausências complementam Colaboradores). */
  relation: z.object({ kind: z.enum(["COMPLEMENTS", "COMPLEMENTED_BY"]), contractKey: z.string(), note: z.string() }).nullable().default(null),
  feeds: z.array(z.object({ feedId: z.string(), feedName: z.string(), sourceId: z.string(), sourceName: z.string(), sourceKind: z.enum(SOURCE_KINDS), status: z.enum(FEED_STATUSES), freshness: z.enum(FRESHNESS_STATES), lastSuccessAt: z.string().nullable(), lastDataAt: z.string().nullable(), authoritative: z.boolean() })),
  freshness: z.enum(FRESHNESS_STATES).nullable(),
  recordCount: z.number().nullable(),
})
export type DataMapEntry = z.infer<typeof dataMapEntrySchema>

export const employmentFeedFreshnessSchema = z.object({
  feedId: z.string(),
  feedName: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  sourceKind: z.string(),
  contractKey: z.string(),
  sourceNamespace: z.string(),
  authoritative: z.boolean(),
  status: z.string(),
  cadenceLabel: z.string(),
  expectedIntervalMinutes: z.number().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastDataAt: z.string().nullable(),
  freshness: z.enum(FRESHNESS_STATES),
})

/** "O estado funcional conhecido está atualizado?" — derivado dos feeds EMPLOYEES/EMPLOYEE_ABSENCES; nunca é a saúde da conexão. */
export const employmentStatusFreshnessSchema = z.object({
  state: z.enum(["FRESH", "STALE", "UNKNOWN"]),
  configured: z.boolean(),
  feeds: z.array(employmentFeedFreshnessSchema),
  consideredFeedIds: z.array(z.string()),
  lastSuccessAt: z.string().nullable(),
  lastDataAt: z.string().nullable(),
  lastSuccessLocalDate: z.string().nullable(),
})
export type EmploymentStatusFreshness = z.infer<typeof employmentStatusFreshnessSchema>

export const holidayCatalogCoverageSchema = z.object({
  years: z.array(z.object({ year: z.number(), national: z.number(), capitalsWithStateHoliday: z.number(), capitalsWithMunicipalHoliday: z.number(), rows: z.number(), byVerification: z.object({ OFFICIAL: z.number(), LEGAL_DATABASE: z.number(), SECONDARY: z.number() }), unverifiedRows: z.number() })),
  totalRows: z.number(),
  gaps: z.array(z.object({ scope: z.enum(["NATIONAL", "STATE", "MUNICIPAL_CAPITAL"]), stateCode: z.string().optional(), capitalCode: z.string().optional(), years: z.array(z.number()), reason: z.string(), label: z.string() })),
  pendingVerifications: z.number(),
  capitalsWithoutMunicipalHoliday: z.array(z.string()),
  complete: z.literal(false),
})
export type HolidayCatalogCoverage = z.infer<typeof holidayCatalogCoverageSchema>

export const calendarQualitySchema = z.object({
  operationalCapital: z.object({ filled: z.number(), total: z.number() }),
  sixByOne: z.object({ withCalendar: z.number(), withoutCalendar: z.number(), total: z.number() }),
  activeExceptionsAhead: z.number().default(0),
  /** Exceções por origem (Central × Supervisor) e conflitos auditáveis (migration 068). */
  exceptionsByOrigin: z.object({ central: z.number(), supervisor: z.number(), conflicts: z.number(), conflictWarnings30d: z.number() }).optional(),
  /** PLANEJADO × OBSERVADO nos últimos dias (job de reconciliação) e fontes de evidência configuradas. */
  reconciliation: z.object({ windowDays: z.number(), openMissingProduction: z.number(), resolvedMissingProduction: z.number(), divergences: z.number(), statusInconsistencies: z.number(), evidenceSources: z.object({ interactions: z.boolean(), indicatorCodes: z.array(z.string()), enabled: z.boolean() }) }).optional(),
  holidayCatalog: holidayCatalogCoverageSchema.optional(),
  /** Disponibilidade esperada (SLA D-1/D-2) por fonte relevante + dias aguardando dados × fonte atrasada nos últimos 7 dias. */
  dataAvailability: z
    .object({
      sources: z.array(z.object({ key: z.string(), label: z.string(), group: z.enum(["WORK_ACTIVITY", "EMPLOYMENT"]), groupLabel: z.string(), policyLabel: z.string(), configured: z.boolean(), referenceDate: z.string().nullable(), state: z.enum(["UNKNOWN", "WAITING", "READY", "DELAYED"]), stateLabel: z.string(), expectedAt: z.string().nullable(), lastSuccessAt: z.string().nullable(), lastDataAt: z.string().nullable(), freshness: z.string().nullable() })),
      withinSla: z.number(),
      delayed: z.number(),
      unknownPolicy: z.number(),
      daysWaitingForData: z.number(),
      daysWithSourceDelay: z.number(),
      daysReady: z.number(),
    })
    .optional(),
  /** Classificações humanas dos últimos 30 dias (falta injustificada, revisões, dado tardio). */
  classifications: z.object({ windowDays: z.number(), unjustifiedAbsences: z.number(), justifiedAbsences: z.number(), workedDataMissing: z.number(), revised: z.number(), contradictedByEvidence: z.number(), supersededByStatus: z.number(), lateDataAutoResolved: z.number(), awaitingClassification: z.number() }).optional(),
})
export type CalendarQuality = z.infer<typeof calendarQualitySchema>

export const overviewSchema = z.object({
  generatedAt: z.string(),
  cards: z.object({ activeSources: z.number(), sourcesWithError: z.number(), receivedToday: z.number(), rejectedToday: z.number(), warningsToday: z.number().default(0), staleFeeds: z.number(), runsToday: z.number(), queuedRuns: z.number() }),
  sources: z.array(sourceSummarySchema),
  dataMap: z.array(dataMapEntrySchema),
  employmentStatus: employmentStatusFreshnessSchema,
  /** Escalas de trabalho — mesma pergunta para o calendário programado (feeds WORK_SCHEDULE_DAYS). */
  workSchedule: employmentStatusFreshnessSchema.optional(),
  /** Horizonte do calendário (até quando a escala é conhecida) — diferente de freshness e de saúde da conexão. */
  workScheduleHorizon: workScheduleHorizonSchema.optional(),
  calendarQuality: calendarQualitySchema.optional(),
  recentRuns: z.array(runSummarySchema.extend({ feedName: z.string(), sourceName: z.string(), contractKey: z.string() })),
})
export type Overview = z.infer<typeof overviewSchema>

export const qualitySchema = z.object({
  topErrors: z.array(z.object({ code: z.string(), label: z.string(), count: z.number() })),
  topWarnings: z.array(z.object({ code: z.string(), label: z.string(), count: z.number() })).default([]),
  totals: z.object({ errors: z.number(), warnings: z.number() }).default({ errors: 0, warnings: 0 }),
  feedsWithRejections: z.array(z.object({ feedId: z.string(), feedName: z.string(), sourceName: z.string(), rejected: z.number(), received: z.number(), rate: z.number() })),
  staleFeeds: z.array(z.object({ feedId: z.string(), feedName: z.string(), sourceName: z.string(), lastSuccessAt: z.string().nullable(), cadenceLabel: z.string() })),
  schemaChanges: z.array(z.object({ feedId: z.string(), feedName: z.string(), sourceName: z.string(), schemaChangedAt: z.string(), lastErrorMessage: z.string().nullable() })),
  recentRejections: z.array(z.object({ runId: z.string(), feedName: z.string(), recordNumber: z.number(), sourceRecordKey: z.string().nullable(), errorCode: z.string(), field: z.string().nullable(), message: z.string(), createdAt: z.string(), severity: z.enum(["ERROR", "WARNING"]).default("ERROR") })),
  /** Calendário operacional: capital preenchida, 6x1 sem calendário, horizonte terminando. */
  calendar: calendarQualitySchema.extend({ horizon: workScheduleHorizonSchema }).optional(),
})
export type QualityReport = z.infer<typeof qualitySchema>

export const sampleSchema = z.object({
  columns: z.array(z.string()),
  records: z.array(z.record(z.string(), z.unknown())),
  totalRecords: z.number(),
  detail: z.string().nullable(),
  suggestedMapping: feedMappingSchema,
  sheets: z.array(z.string()).optional(),
  rawObjectId: z.string().nullable().optional(),
  /** Banco externo: descrição AO VIVO do objeto lido (colunas, chave primária). */
  database: databaseObjectDescriptionSchema.optional(),
})
export type Sample = z.infer<typeof sampleSchema>

export const uploadResultSchema = z.object({
  rawObjectId: z.string(),
  filename: z.string(),
  byteSize: z.number(),
  checksumSha256: z.string(),
  format: z.enum(["CSV", "XLSX"]),
  columns: z.array(z.string()),
  records: z.array(z.record(z.string(), z.unknown())),
  totalRecords: z.number(),
  detail: z.string().nullable(),
  sheets: z.array(z.string()),
  suggestedMapping: feedMappingSchema.nullable(),
})
export type UploadResult = z.infer<typeof uploadResultSchema>

export const previewSchema = z.object({
  rows: z.array(z.object({ recordNumber: z.number(), sourceRecordKey: z.string().nullable(), valid: z.boolean(), record: z.record(z.string(), z.unknown()), errors: z.array(z.object({ code: z.string(), field: z.string().nullable(), message: z.string() })), normalized: z.record(z.string(), z.string().nullable()).default({}) })),
  sampled: z.number(),
  valid: z.number(),
  rejected: z.number(),
  mappingProblems: z.array(z.string()),
  schemaWarnings: z.array(z.object({ field: z.string(), source: z.string(), required: z.boolean() })),
  fingerprint: z.object({ columns: z.array(z.string()), hash: z.string() }),
  errorSummary: z.array(z.object({ code: z.string(), count: z.number() })),
})
export type Preview = z.infer<typeof previewSchema>

export const connectionTestSchema = z.object({ health: z.enum(["HEALTHY", "ERROR"]), detail: z.string(), errorCode: z.string().nullable(), checkedAt: z.string(), database: databaseReportSchema.nullable().optional() })
export type ConnectionTest = z.infer<typeof connectionTestSchema>

export const lineageEntrySchema = z.object({ runId: z.string(), feedId: z.string(), feedName: z.string(), sourceId: z.string(), sourceName: z.string(), sourceKind: z.enum(SOURCE_KINDS), contractKey: z.string(), sourceRecordKey: z.string().nullable(), recordNumber: z.number().nullable(), action: z.string(), createdAt: z.string(), runFinishedAt: z.string().nullable() })
export type LineageEntry = z.infer<typeof lineageEntrySchema>

export const sftpFileSchema = z.object({ name: z.string(), path: z.string(), size: z.number(), modifiedAt: z.string().nullable(), matches: z.boolean() })
export type SftpFile = z.infer<typeof sftpFileSchema>

// ---- Registro da Central: quem fez o quê ----------------------------------------------------
export const auditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  entityType: z.string(),
  entityId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  sourceKind: z.string().nullable(),
  sourceDeletedAt: z.string().nullable(),
  feedId: z.string().nullable(),
  feedName: z.string().nullable(),
  feedDeletedAt: z.string().nullable(),
})
export type AuditEvent = z.infer<typeof auditEventSchema>
