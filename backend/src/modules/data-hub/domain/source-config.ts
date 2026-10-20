import { z } from "zod"
import { csvOptionsSchema } from "./csv-parser.js"
import { availabilityPolicySchema } from "./data-availability.js"
import { databaseConfigSchema } from "./database/database-engine.js"
import { databaseFeedConfigSchema } from "./database/database-sync.js"
import { cadenceSchema, LOAD_MODES } from "./freshness.js"
import { feedMappingSchema } from "./mapping.js"

/**
 * Configuração (NÃO secreta) de fontes e feeds. Segredos (token, senha, chave privada, client
 * secret) nunca entram aqui — vivem cifrados em `data_secrets` e só o adaptador de conexão os lê.
 */
export const SOURCE_KINDS = ["FILE_UPLOAD", "API_PULL", "API_PUSH", "SFTP", "DATABASE"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** Fontes que a INIA consulta por conta própria (agenda, "Sincronizar agora", saúde da conexão). */
export const REMOTE_SOURCE_KINDS: readonly SourceKind[] = ["API_PULL", "SFTP", "DATABASE"]

const headerRecord = z.record(z.string().min(1).max(100), z.string().max(2000)).default({})

export const apiPullConfigSchema = z.object({
  baseUrl: z.string().url().max(500),
  auth: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("NONE") }),
      z.object({ kind: z.literal("BEARER") }),
      z.object({ kind: z.literal("API_KEY"), headerName: z.string().min(1).max(100).default("X-API-Key") }),
      z.object({ kind: z.literal("BASIC"), username: z.string().min(1).max(200) }),
      z.object({ kind: z.literal("OAUTH2_CLIENT_CREDENTIALS"), tokenUrl: z.string().url().max(500), clientId: z.string().min(1).max(200), scope: z.string().max(500).optional() }),
    ])
    .default({ kind: "NONE" }),
  headers: headerRecord,
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
})
export type ApiPullConfig = z.infer<typeof apiPullConfigSchema>

export const sftpConfigSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(200),
  remoteDirectory: z.string().min(1).max(500).default("/"),
  authKind: z.enum(["PASSWORD", "PRIVATE_KEY"]),
  /** Fingerprint SHA-256 (base64) da host key esperada — verificação NUNCA é desligada silenciosamente. */
  hostKeyFingerprint: z.string().min(1).max(200).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
})
export type SftpConfig = z.infer<typeof sftpConfigSchema>

export const sourceConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FILE_UPLOAD") }),
  z.object({ kind: z.literal("API_PUSH") }),
  z.object({ kind: z.literal("API_PULL"), api: apiPullConfigSchema }),
  z.object({ kind: z.literal("SFTP"), sftp: sftpConfigSchema }),
  z.object({ kind: z.literal("DATABASE"), database: databaseConfigSchema }),
])
export type SourceConfig = z.infer<typeof sourceConfigSchema>

/**
 * API Pull por `http://` com credencial: a senha/token viaja sem criptografia (R-29). Não é bloqueado — há APIs internas sem
 * TLS e recusar quebraria integrações existentes —, mas a tela avisa enquanto a fonte estiver assim.
 */
export function insecureCredentialTransportWarning(config: SourceConfig): string | null {
  if (config.kind !== "API_PULL" || config.api.auth.kind === "NONE") return null
  const auth = config.api.auth
  const urls = [config.api.baseUrl, auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? auth.tokenUrl : null]
  if (!urls.some((url) => url?.toLowerCase().startsWith("http://"))) return null
  return "Esta fonte envia credencial por http:// (sem criptografia): quem estiver na mesma rede pode ler a senha ou o token. Use https:// sempre que a API do cliente oferecer."
}

/** Segredos aceitos na criação/rotação — nunca persistidos em claro, nunca devolvidos. */
export const sourceSecretsSchema = z.object({
  token: z.string().min(1).max(4000).optional(),
  apiKey: z.string().min(1).max(4000).optional(),
  password: z.string().min(1).max(4000).optional(),
  clientSecret: z.string().min(1).max(4000).optional(),
  privateKey: z.string().min(1).max(20_000).optional(),
  passphrase: z.string().min(1).max(4000).optional(),
})
export type SourceSecrets = z.infer<typeof sourceSecretsSchema>

export const SECRET_PURPOSES = ["API_AUTH", "SFTP_PASSWORD", "SFTP_PRIVATE_KEY", "SFTP_PASSPHRASE", "DATABASE_PASSWORD"] as const
export type SecretPurpose = (typeof SECRET_PURPOSES)[number]

// ---------------------------------------------------------------------------------------------
// Conector do feed
// ---------------------------------------------------------------------------------------------
export const paginationSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("NONE") }),
    z.object({ kind: z.literal("PAGE_NUMBER"), pageParam: z.string().min(1).default("page"), sizeParam: z.string().min(1).optional(), pageSize: z.number().int().min(1).max(10_000).default(500), startPage: z.number().int().min(0).default(1) }),
    z.object({ kind: z.literal("OFFSET"), offsetParam: z.string().min(1).default("offset"), limitParam: z.string().min(1).default("limit"), limit: z.number().int().min(1).max(10_000).default(500) }),
    z.object({ kind: z.literal("CURSOR"), cursorParam: z.string().min(1).default("cursor"), nextCursorPath: z.string().min(1) }),
  ])
  .default({ kind: "NONE" })

export const apiPullFeedConfigSchema = z.object({
  format: z.literal("JSON").default("JSON"),
  endpoint: z.string().min(1).max(500),
  method: z.enum(["GET", "POST"]).default("GET"),
  queryParams: z.record(z.string().min(1), z.string()).default({}),
  headers: headerRecord,
  /** Dot path até o array de registros na resposta (vazio = a resposta É o array). */
  extractPath: z.string().max(200).default(""),
  pagination: paginationSchema,
  /** Checkpoint incremental: envia o último valor visto de `sourceField` no parâmetro `requestParam`. */
  checkpoint: z
    .discriminatedUnion("kind", [z.object({ kind: z.literal("NONE") }), z.object({ kind: z.literal("WATERMARK"), sourceField: z.string().min(1), requestParam: z.string().min(1) })])
    .default({ kind: "NONE" }),
  maxPages: z.number().int().min(1).max(10_000).default(500),
})

export const fileFormatSchema = z.enum(["CSV", "XLSX"])

export const excelFeedOptionsSchema = z.object({
  sheet: z.string().min(1).optional(),
  hasHeader: z.boolean().default(true),
  skipRows: z.number().int().min(0).max(100).default(0),
})

export const fileFeedConfigSchema = z.object({
  format: fileFormatSchema.default("CSV"),
  csv: csvOptionsSchema.default({ encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 }),
  excel: excelFeedOptionsSchema.default({ hasHeader: true, skipRows: 0 }),
})

export const sftpFeedConfigSchema = fileFeedConfigSchema.extend({
  /** Glob simples: `employees_*.csv`, `medicoes_????.xlsx`. Cada pattern é um feed. */
  filePattern: z.string().min(1).max(200),
  remoteDirectory: z.string().max(500).optional(),
})

export const apiPushFeedConfigSchema = z.object({
  format: z.literal("JSON").default("JSON"),
  /** Dot path até o array no corpo enviado (padrão `records`). */
  extractPath: z.string().max(200).default("records"),
})

export const feedConnectorConfigSchema = z.discriminatedUnion("connector", [
  z.object({ connector: z.literal("FILE_UPLOAD"), file: fileFeedConfigSchema.default({ format: "CSV", csv: { encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } }) }),
  z.object({ connector: z.literal("API_PULL"), api: apiPullFeedConfigSchema }),
  z.object({ connector: z.literal("API_PUSH"), push: apiPushFeedConfigSchema.default({ format: "JSON", extractPath: "records" }) }),
  z.object({ connector: z.literal("SFTP"), sftp: sftpFeedConfigSchema }),
  z.object({ connector: z.literal("DATABASE"), database: databaseFeedConfigSchema }),
])
export type FeedConnectorConfig = z.infer<typeof feedConnectorConfigSchema>

export const feedInputSchema = z.object({
  feedKey: z.string().regex(/^[a-z0-9][a-z0-9-_]{1,63}$/, "Use letras minúsculas, números, hífen ou underscore."),
  name: z.string().trim().min(2).max(120),
  contractKey: z.string().min(1),
  /** Ausente = versão atual do contrato (feed novo nunca nasce numa versão anterior por omissão). */
  contractVersion: z.number().int().min(1).optional(),
  connectorConfig: feedConnectorConfigSchema,
  mapping: feedMappingSchema.default({ fields: [] }),
  loadMode: z.enum(LOAD_MODES).default("DELTA"),
  cadence: cadenceSchema.default({ kind: "MANUAL" }),
  authoritative: z.boolean().default(false),
  failOnAnyRejection: z.boolean().default(false),
  sourceNamespace: z.string().trim().min(1).max(64).optional(),
  /** DISPONIBILIDADE ESPERADA (D-1/D-2 + horário local) — distinta da cadência; null = não configurada (nenhuma ausência é concluída). */
  availabilityPolicy: availabilityPolicySchema.nullable().default(null),
})
export type FeedInput = z.infer<typeof feedInputSchema>

export const sourceInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  config: sourceConfigSchema,
  secrets: sourceSecretsSchema.optional(),
})
export type SourceInput = z.infer<typeof sourceInputSchema>

/**
 * Glob simples (`*`, `?`), sem diferenciar maiúsculas, casado SEM expressão regular: o nome vem do servidor SFTP e `*a*a*a…`
 * virava retrocesso exponencial — 64 s com o event loop parado num nome de 60 letras (achado DATA-11 da auditoria de
 * 17/10/2026). Dois ponteiros com retomada na última `*`: no pior caso padrão × nome passos, nunca exponencial.
 */
export function matchesGlob(pattern: string, name: string): boolean {
  const p = pattern.toLowerCase()
  const n = name.toLowerCase()
  let pi = 0
  let ni = 0
  let star = -1
  let resume = 0
  while (ni < n.length) {
    if (pi < p.length && (p[pi] === "?" || p[pi] === n[ni])) {
      pi += 1
      ni += 1
    } else if (pi < p.length && p[pi] === "*") {
      star = pi
      resume = ni
      pi += 1
    } else if (star >= 0) {
      pi = star + 1
      resume += 1
      ni = resume
    } else {
      return false
    }
  }
  while (pi < p.length && p[pi] === "*") pi += 1
  return pi === p.length
}
