import { DATABASE_ENGINE_LABELS, DATABASE_TLS_LABELS, type AuditEvent, type DatabaseEngine, type DatabaseTlsMode } from "@/schemas/admin/data-hub.schema"

import { formatDateTime } from "./data-hub-format"

/** Rótulos do registro da Central. Ação sem rótulo aparece pelo código, nunca some. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  DATA_HUB_SOURCE_CREATED: "Fonte cadastrada",
  DATA_HUB_SOURCE_CREATE_REFUSED: "Cadastro recusado",
  DATA_HUB_SOURCE_UPDATED: "Fonte alterada",
  DATA_HUB_SOURCE_DELETED: "Fonte excluída",
  DATA_HUB_SOURCE_ACTIVATED: "Fonte ativada",
  DATA_HUB_SOURCE_PAUSED: "Fonte pausada",
  DATA_HUB_SOURCE_RESUMED: "Fonte retomada",
  DATA_HUB_SECRET_ROTATED: "Senha trocada",
  DATA_HUB_SECRET_ROTATION_FAILED: "Troca de senha recusada",
  DATA_HUB_CONFIG_UNLOCKED: "Configuração liberada",
  DATA_HUB_CONFIG_UNLOCK_FAILED: "Senha incorreta",
  DATA_HUB_CONFIG_UNLOCK_BLOCKED: "Bloqueio por tentativas",
  DATA_HUB_CONFIG_ACCESS_DENIED: "Ação negada sem liberação",
  DATA_HUB_CONNECTION_TESTED: "Conexão testada",
  DATA_HUB_DATABASE_TESTED: "Conexão de banco testada",
  DATA_HUB_DATABASE_OBJECTS_LISTED: "Tabelas listadas",
  DATA_HUB_DATABASE_COLUMNS_READ: "Colunas lidas",
  DATA_HUB_SAMPLE_READ: "Amostra lida",
  DATA_HUB_SFTP_FILES_LISTED: "Arquivos do SFTP listados",
  DATA_HUB_FEED_CREATED: "Conjunto criado",
  DATA_HUB_FEED_UPDATED: "Conjunto alterado",
  DATA_HUB_FEED_DELETED: "Conjunto excluído",
  DATA_HUB_FEED_ACTIVATED: "Conjunto ativado",
  DATA_HUB_FEED_PAUSED: "Conjunto pausado",
  DATA_HUB_FEED_RESUMED: "Conjunto retomado",
  DATA_HUB_CHECKPOINT_RESET: "Leitura reiniciada",
  DATA_HUB_SYNC_REQUESTED: "Sincronização pedida",
  DATA_HUB_REPROCESS_REQUESTED: "Reprocessamento pedido",
  DATA_HUB_RUN_CANCELLED: "Carga cancelada",
  DATA_HUB_REJECTIONS_EXPORTED: "Rejeições exportadas",
  DATA_HUB_FILE_UPLOADED: "Arquivo enviado",
  DATA_HUB_FILE_IMPORTED: "Arquivo importado",
  DATA_HUB_PUSH_TOKEN_CREATED: "Token de push criado",
  DATA_HUB_PUSH_TOKEN_REVOKED: "Token de push revogado",
  DATA_HUB_EXPLORER_QUERY: "Consulta de dados",
  DATA_HUB_EXPLORER_COUNT: "Contagem de dados",
  DATA_HUB_EXPLORER_EXPORT_STARTED: "Exportação iniciada",
  DATA_HUB_EXPLORER_EXPORT_FINISHED: "Exportação encerrada",
  DATA_HUB_EXPLORER_DENIED: "Consulta de dados negada",
  DATA_HUB_RECORDS_CANCEL_PREVIEW: "Prévia de cancelamento de registros",
  DATA_HUB_RECORDS_CANCEL_LIST: "Leitura dos cancelamentos",
  DATA_HUB_RECORDS_REACTIVATION_PREVIEW: "Prévia de reativação de registros",
  DATA_HUB_RECORDS_CANCELLED: "Registros cancelados",
  DATA_HUB_RECORDS_REACTIVATED: "Registros reativados",
  DATA_HUB_DELETED_ITEMS_LIST: "Leitura dos itens excluídos",
  DATA_HUB_DELETED_ITEM_RESTORE_PREVIEW: "Prévia de restauração",
  DATA_HUB_DELETED_ITEM_RESTORED: "Item excluído restaurado",
}

const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  description: "Descrição",
  engine: "Tipo do banco",
  host: "Servidor",
  port: "Porta",
  instance: "Instância",
  database: "Banco",
  username: "Usuário",
  tls: "Criptografia",
  authKind: "Autenticação",
  origin: "Endereço",
  tokenOrigin: "Endereço do token",
  caCertificate: "Certificado da autoridade",
  connectTimeoutMs: "Tempo limite de conexão",
  queryTimeoutMs: "Tempo limite de consulta",
  timeoutMs: "Tempo limite",
  remoteDirectory: "Diretório remoto",
  hostKeyFingerprint: "Chave do servidor",
  baseUrl: "Base URL",
  headers: "Cabeçalhos",
  headerName: "Nome do cabeçalho",
  clientId: "Client ID",
  tokenUrl: "URL do token",
  scope: "Escopo",
  feedKey: "Chave",
  contractKey: "Contrato",
  contractVersion: "Versão do contrato",
  connectorConfig: "Conector",
  mapping: "Mapeamento",
  loadMode: "Modo de carga",
  cadence: "Frequência",
  authoritative: "Fonte oficial",
  failOnAnyRejection: "Carga íntegra",
  sourceNamespace: "Namespace",
  availabilityPolicy: "Disponibilidade",
}

const UNLOCK_METHOD_LABELS: Record<string, string> = {
  PASSWORD_ENTERED: "com a senha digitada",
  SOURCE_CREATED: "ao cadastrar a fonte",
  CREDENTIAL_CHANGED: "ao trocar a senha",
}

const text = (value: unknown): string => (value === null || value === undefined || value === "" ? "—" : String(value))
const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field
/** Valor como a tela de conexão mostra: "Obrigatória e validando o certificado", nunca o código. */
function fieldValue(field: string, value: unknown): string {
  if (field === "tls") return DATABASE_TLS_LABELS[value as DatabaseTlsMode] ?? text(value)
  if (field === "engine") return DATABASE_ENGINE_LABELS[value as DatabaseEngine] ?? text(value)
  return text(value)
}
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])
const count = (value: unknown, one: string, many: string) => `${text(value)} ${value === 1 ? one : many}`

function describeTarget(target: unknown): string[] {
  if (!target || typeof target !== "object") return []
  return Object.entries(target as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([field, value]) => `${fieldLabel(field)}: ${fieldValue(field, value)}`)
}

/** Linhas de detalhe de um evento, em linguagem de gente. Nunca há segredo no payload: o que não tem regra aqui não aparece. */
export function describeAuditEvent(event: AuditEvent): string[] {
  const payload = event.payload
  const lines: string[] = []
  switch (event.action) {
    case "DATA_HUB_SOURCE_CREATED":
    case "DATA_HUB_SOURCE_DELETED":
      lines.push(...describeTarget(payload.target))
      break
    case "DATA_HUB_SOURCE_CREATE_REFUSED":
      lines.push(`"${text(payload.name)}": o servidor recusou a credencial, nada foi gravado`, ...describeTarget(payload.target))
      break
    case "DATA_HUB_REJECTIONS_EXPORTED":
      lines.push(count(payload.rows, "linha", "linhas"))
      break
    case "DATA_HUB_SOURCE_UPDATED": {
      const changes = Array.isArray(payload.changes) ? (payload.changes as { field: string; before: unknown; after: unknown }[]) : []
      for (const change of changes) lines.push(`${fieldLabel(change.field)}: ${fieldValue(change.field, change.before)} → ${fieldValue(change.field, change.after)}`)
      const changedFields = list(payload.changedFields)
      if (changedFields.length > 0) lines.push(`Também mudou: ${changedFields.map(fieldLabel).join(", ")}`)
      if (list(payload.secretsRotated).length > 0) lines.push("Senha trocada, depois de testada")
      break
    }
    case "DATA_HUB_FEED_UPDATED": {
      if (payload.previousName) lines.push(`Nome: ${text(payload.previousName)} → ${text(payload.name)}`)
      const changedFields = list(payload.changedFields).filter((field) => field !== "name")
      if (changedFields.length > 0) lines.push(`Mudou: ${changedFields.map(fieldLabel).join(", ")}`)
      break
    }
    case "DATA_HUB_FEED_CREATED":
      if (payload.contract) lines.push(`Contrato ${text(payload.contract)}`)
      break
    case "DATA_HUB_CONFIG_UNLOCKED":
      lines.push(`${UNLOCK_METHOD_LABELS[String(payload.method)] ?? "liberada"}, até ${formatDateTime(String(payload.expiresAt))}`)
      break
    case "DATA_HUB_CONFIG_UNLOCK_BLOCKED":
      lines.push(`Novas tentativas a partir de ${formatDateTime(String(payload.retryAt))}`, ...describeTarget(payload.target))
      break
    case "DATA_HUB_CONFIG_ACCESS_DENIED":
      lines.push(`Rota: ${text(payload.route)}`)
      break
    case "DATA_HUB_SECRET_ROTATED":
      lines.push("A senha nova passou no teste de conexão")
      break
    case "DATA_HUB_DATABASE_OBJECTS_LISTED":
      if (payload.outcome !== "FAILED") lines.push(`${count(payload.objects, "tabela ou visão", "tabelas ou visões")}${payload.truncated ? " (lista cortada)" : ""}`)
      break
    case "DATA_HUB_DATABASE_COLUMNS_READ":
      lines.push(text(payload.object))
      if (payload.outcome !== "FAILED") lines.push(count(payload.columns, "coluna", "colunas"))
      break
    case "DATA_HUB_SAMPLE_READ":
      lines.push(text(payload.object))
      if (payload.outcome !== "FAILED") lines.push(count(payload.rows, "linha", "linhas"))
      break
    case "DATA_HUB_SFTP_FILES_LISTED":
      if (payload.outcome !== "FAILED") lines.push(count(payload.files, "arquivo", "arquivos"))
      break
    case "DATA_HUB_FILE_UPLOADED":
      lines.push(text(payload.filename), count(payload.rows, "linha", "linhas"))
      break
    case "DATA_HUB_FILE_IMPORTED":
      if (payload.filename) lines.push(text(payload.filename))
      break
    case "DATA_HUB_EXPLORER_QUERY":
    case "DATA_HUB_EXPLORER_COUNT":
    case "DATA_HUB_EXPLORER_EXPORT_STARTED":
    case "DATA_HUB_EXPLORER_EXPORT_FINISHED":
    case "DATA_HUB_RECORDS_CANCEL_PREVIEW":
    case "DATA_HUB_RECORDS_CANCEL_LIST":
    case "DATA_HUB_RECORDS_REACTIVATION_PREVIEW":
    case "DATA_HUB_RECORDS_CANCELLED":
    case "DATA_HUB_RECORDS_REACTIVATED":
    case "DATA_HUB_DELETED_ITEMS_LIST":
    case "DATA_HUB_DELETED_ITEM_RESTORE_PREVIEW":
    case "DATA_HUB_DELETED_ITEM_RESTORED": {
      if (payload.itemName) lines.push(`Item: ${text(payload.itemName)}`)
      if (payload.dataset) lines.push(`Conjunto: ${text(payload.dataset)}`)
      if (typeof payload.rows === "number") lines.push(count(payload.rows, "linha", "linhas"))
      if (typeof payload.durationMs === "number") lines.push(`${payload.durationMs} ms`)
      const filterColumns = list(payload.filterColumns)
      if (filterColumns.length > 0) lines.push(`Filtros em: ${filterColumns.join(", ")}`)
      if (payload.searched === true) lines.push("Com busca")
      if (payload.result === "INTERRUPTED") lines.push(`Interrompida: ${text(payload.interruption)}`)
      if (payload.result === "REJECTED" || payload.result === "FAILED") lines.push(`${payload.result === "FAILED" ? "Falhou" : "Recusada"}: ${text(payload.errorCode)}`)
      break
    }
    case "DATA_HUB_CONNECTION_TESTED":
    case "DATA_HUB_DATABASE_TESTED":
      lines.push(payload.health === "HEALTHY" ? "Conexão OK" : `Com erro${payload.errorCode ? `: ${text(payload.errorCode)}` : ""}`)
      if (payload.usedStoredPassword === true) lines.push("Usou a senha guardada")
      lines.push(...(typeof payload.target === "string" ? [payload.target] : []))
      break
    default:
      break
  }
  if (event.action === "DATA_HUB_SECRET_ROTATION_FAILED" && payload.errorCode === "DATA_SOURCE_CREDENTIAL_UNPROVEN") lines.push("A API responde igual com e sem credencial: a nova não pôde ser provada")
  else if (payload.outcome === "FAILED" || (event.action === "DATA_HUB_SECRET_ROTATION_FAILED" && payload.errorCode)) lines.push(`Falhou: ${text(payload.errorCode)}`)
  return lines
}
