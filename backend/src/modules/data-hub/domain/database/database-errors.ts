import { DataRunError, NOT_A_CREDENTIAL_REFUSAL, type DataRunErrorCode } from "../error-codes.js"
import { DATABASE_ENGINE_LABELS, type DatabaseEngine } from "./database-engine.js"

/**
 * Erro de driver (pg, mssql/tedious, mysql2, rede, TLS) → código estável da Central + mensagem em português que
 * diz o que fazer. A mensagem do driver só entra depois de limpa (nunca a senha). Transitórios (rede/tempo) têm
 * retentativa automática na carga; os demais pedem ação de quem configura.
 */
export type DatabaseErrorContext = {
  engine: DatabaseEngine
  host: string
  port: number | null
  database: string
  username: string
  instanceName?: string | null
  /** Objeto lido (esquema.nome) quando o erro aconteceu numa consulta. */
  object?: string | null
  phase: "CONNECT" | "QUERY"
  /** Valores que NUNCA podem aparecer na mensagem (senha). */
  secrets?: readonly string[]
}

type DriverError = { code?: unknown; errno?: unknown; number?: unknown; sqlState?: unknown; message?: unknown; originalError?: unknown; cause?: unknown; reason?: unknown }

function flatten(error: unknown): DriverError[] {
  const chain: DriverError[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    chain.push(current as DriverError)
    const next = (current as DriverError).originalError ?? (current as DriverError).cause
    if (next === current) break
    current = next
  }
  // AggregateError (várias tentativas de endereço do DNS) — a primeira já diz o motivo.
  const errors = (error as { errors?: unknown })?.errors
  if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") chain.push(errors[0] as DriverError)
  return chain
}

const TLS_CODES = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_SSL_WRONG_VERSION_NUMBER", "HANDSHAKE_NO_SSL_SUPPORT", "EPROTO"])
const NETWORK_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EPIPE", "ESOCKET", "PROTOCOL_CONNECTION_LOST"])
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ETIMEOUT", "PROTOCOL_SEQUENCE_TIMEOUT", "ESOCKETTIMEDOUT"])

export function sanitizeDriverMessage(message: string, secrets: readonly string[] = []): string {
  let text = message.replace(/\s+/g, " ").trim()
  for (const secret of secrets) if (secret && secret.length >= 3) text = text.split(secret).join("***")
  // Strings de conexão eventualmente ecoadas (postgres://user:senha@host) — nunca saem com a senha.
  text = text.replace(/(\w+:\/\/[^:\s/]+:)[^@\s]+@/g, "$1***@")
  return text.slice(0, 400)
}

export function classifyDatabaseError(error: unknown, context: DatabaseErrorContext): DataRunError {
  if (error instanceof DataRunError) return error
  const chain = flatten(error)
  const codes = new Set(chain.map((entry) => (typeof entry.code === "string" ? entry.code : null)).filter(Boolean) as string[])
  const numbers = new Set(chain.flatMap((entry) => [entry.errno, entry.number]).filter((value): value is number => typeof value === "number"))
  const message = chain.map((entry) => (typeof entry.message === "string" ? entry.message : "")).filter(Boolean).join(" · ")
  const lower = message.toLowerCase()
  const engine = DATABASE_ENGINE_LABELS[context.engine]
  const where = context.engine === "SQLSERVER" && context.instanceName ? `${context.host}\\${context.instanceName}` : `${context.host}${context.port ? `:${context.port}` : ""}`
  const detail = sanitizeDriverMessage(message || String(error), [...(context.secrets ?? [])])
  const make = (code: DataRunErrorCode, text: string, details?: unknown) => new DataRunError(code, `${text}${detail ? ` (detalhe: ${detail})` : ""}`, details)

  // --- TLS / certificado -----------------------------------------------------------------------
  if ([...codes].some((code) => TLS_CODES.has(code)) || /self[- ]signed certificate|certificate has expired|unable to verify the first certificate|altnames|does not support ssl|does not support secure|ssl is required|\bcertificate\b|\btls\b|handshake failed|wrong version number/.test(lower)) {
    if (/does not support ssl|does not support secure|no_ssl_support/.test(lower) || codes.has("HANDSHAKE_NO_SSL_SUPPORT")) {
      return make("DATA_SOURCE_TLS_FAILED", `O servidor ${engine} em ${where} não oferece conexão segura (TLS). Use "Usar quando o servidor oferecer" ou "Desligada" só se a rede for privada e confiável.`)
    }
    if (/no pg_hba\.conf entry/.test(lower)) {
      return make("DATA_SOURCE_PERMISSION_DENIED", `O servidor ${engine} recusou esta origem (pg_hba.conf). Peça ao administrador do banco para liberar o IP do servidor da INIA e o modo de criptografia escolhido.`)
    }
    return make("DATA_SOURCE_TLS_FAILED", `O certificado do servidor ${engine} em ${where} não pôde ser validado (vencido, autoassinado ou com outro nome). Informe o certificado da CA ou use "Obrigatória (sem validar certificado)" se aceitar esse risco.`)
  }

  // --- Autenticação ------------------------------------------------------------------------------
  // SQL Server com banco inexistente manda 4060 ("Cannot open database …") E 18456 ("Login failed …"): vale o primeiro.
  const databaseAccessDenied = numbers.has(1044) || codes.has("ER_DBACCESS_DENIED_ERROR") || /access denied for user .* to database/.test(lower) || numbers.has(4060) || /cannot open database|cannot open the database/.test(lower)
  const authFailed =
    !databaseAccessDenied &&
    (codes.has("28P01") || codes.has("28000") || numbers.has(1045) || codes.has("ER_ACCESS_DENIED_ERROR") || numbers.has(18456) ||
      codes.has("ELOGIN") || /password authentication failed|login failed for user|access denied for user/.test(lower))
  if (authFailed && !/no pg_hba\.conf entry/.test(lower)) {
    return make("DATA_SOURCE_AUTH_FAILED", `O ${engine} recusou o usuário "${context.username}" ou a senha. Confira as credenciais${context.engine === "SQLSERVER" ? " e se o servidor aceita login por usuário e senha (autenticação do SQL Server)" : ""}.`)
  }
  if (/no pg_hba\.conf entry/.test(lower)) {
    return make("DATA_SOURCE_PERMISSION_DENIED", `O servidor ${engine} não aceita conexões desta origem para o usuário "${context.username}" (pg_hba.conf). Peça ao administrador do banco para liberar o IP do servidor da INIA.`)
  }
  if (numbers.has(1251) || codes.has("ER_NOT_SUPPORTED_AUTH_MODE")) {
    return make("DATA_SOURCE_AUTH_FAILED", `O método de autenticação do usuário "${context.username}" não é suportado. Use um usuário com autenticação por senha padrão do ${engine}.`, NOT_A_CREDENTIAL_REFUSAL)
  }

  // --- Banco / instância inexistente ----------------------------------------------------------------
  if (databaseAccessDenied || codes.has("3D000") || numbers.has(1049) || codes.has("ER_BAD_DB_ERROR") || /cannot open database|cannot open the database|database ".*" does not exist|unknown database/.test(lower)) {
    return make("DATA_SOURCE_NOT_FOUND", `O banco "${context.database}" não existe em ${where} ou o usuário "${context.username}" não tem acesso a ele.`)
  }
  if (codes.has("EINSTLOOKUP") || /instance.*not found|failed to get port number|could not find instance|port for .* not found/.test(lower)) {
    return make("DATA_SOURCE_NOT_FOUND", `A instância "${context.instanceName ?? ""}" não foi encontrada em ${context.host}. Confira o nome da instância e se o serviço SQL Browser (UDP 1434) está acessível — ou informe a porta da instância em vez do nome.`)
  }

  // --- Permissão --------------------------------------------------------------------------------
  if (codes.has("42501") || numbers.has(229) || numbers.has(230) || numbers.has(1142) || numbers.has(1143) || /permission denied|was denied on the object|command denied to user/.test(lower)) {
    return make("DATA_SOURCE_PERMISSION_DENIED", `O usuário "${context.username}" não tem permissão de leitura${context.object ? ` em ${context.object}` : ""}. Conceda SELECT a esse usuário (somente leitura) e tente de novo.`)
  }

  // --- Mudança de estrutura (durante a leitura) ----------------------------------------------------
  if (codes.has("42P01") || codes.has("42703") || numbers.has(208) || numbers.has(207) || numbers.has(1146) || numbers.has(1054) || /does not exist|invalid object name|invalid column name|unknown column|doesn't exist/.test(lower)) {
    return make("DATA_SCHEMA_CHANGED", `${context.object ? `A estrutura de ${context.object}` : "A estrutura da origem"} mudou: uma tabela, visão ou coluna usada não existe mais (ou deixou de ser visível para o usuário). Revise o conjunto de dados.`)
  }

  // --- Tempo ------------------------------------------------------------------------------------
  if ([...codes].some((code) => TIMEOUT_CODES.has(code)) || codes.has("57014") || numbers.has(3024) || numbers.has(1969) || numbers.has(1222) || /timeout|timed out|canceling statement due to statement timeout|maximum statement execution time|lock request time out/.test(lower)) {
    return context.phase === "CONNECT"
      ? make("DATA_SOURCE_TIMEOUT", `O servidor ${engine} em ${where} não respondeu a tempo. Confira se o endereço e a porta estão corretos e se o firewall libera o acesso a partir do servidor da INIA.`)
      : make("DATA_SOURCE_TIMEOUT", `A consulta em ${context.object ?? "na origem"} passou do tempo-limite. Tente uma página menor, um horário de menos carga ou peça um índice no campo de ordenação.`)
  }

  // --- Rede ---------------------------------------------------------------------------------------
  if ([...codes].some((code) => NETWORK_CODES.has(code)) || /getaddrinfo|econnrefused|connect econn|socket hang up|connection terminated|could not connect|failed to connect|connection lost|server has gone away/.test(lower)) {
    return make("DATA_SOURCE_UNREACHABLE", `Não foi possível conectar em ${where} a partir do servidor da INIA. Confira o endereço e a porta; se o banco está numa rede privada, ela precisa estar acessível a partir do servidor onde a INIA roda (VPN, liberação de firewall ou túnel).`)
  }

  return make("DATA_SOURCE_RESPONSE_INVALID", `O ${engine} respondeu com um erro inesperado.`)
}
