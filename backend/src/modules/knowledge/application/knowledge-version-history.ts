import type { Database } from "../../../infrastructure/database/pool.js"
import { diffConfigField, diffText, diffWords, type ConfigDiffRow, type TextDiff, type WordDiff } from "../domain/knowledge-version-diff.js"
import type { PdfExtraction } from "../domain/pdf-markdown/layout.js"
import { lifecycleOf, parseKnowledgeExtraction, parseKnowledgeVersionConfig, type KnowledgeVersionConfig } from "./knowledge-versions.js"

/**
 * Histórico e comparação das versões da base (PEN-008). Só leitura. A permissão é decidida no router: esta camada recebe o que a pessoa
 * pode ver de cada versão (`canRead`) e nunca devolve conteúdo, autor ou configuração de uma versão restrita.
 */
type Queryable = Pick<Database, "query">

export type KnowledgeVersionSituation = "IN_USE" | "ARCHIVED" | "REPLACED" | "DRAFT" | "OLD_DRAFT" | "PROCESSING" | "FAILED" | "SUPERSEDED"

type HistoryRow = {
  id: string
  version: number
  status: string
  origin: string
  text_status: string
  config: unknown
  change_summary: string | null
  created_at: Date
  created_by_name: string | null
  updated_at: Date | null
  updated_by_name: string | null
  publish_requested_at: Date | null
  publish_requested_by_name: string | null
  published_at: Date | null
  published_by_name: string | null
  reactivation_confirmed_at: Date | null
  reactivation_confirmed_by_name: string | null
  processing_error_code: string | null
  processing_error_message: string | null
  superseded_reason: string | null
  reverted_from_version: number | null
  usage_count: number
  last_used_at: Date | null
}

export function situationOf(row: { id: string; status: string }, lifecycle: { live: { id: string } | null; draft: { id: string } | null }): KnowledgeVersionSituation {
  switch (row.status) {
    case "PUBLISHED":
      return lifecycle.live?.id === row.id ? "IN_USE" : "REPLACED"
    case "ARCHIVED":
      return "ARCHIVED"
    case "PROCESSING":
      return "PROCESSING"
    case "FAILED":
      return "FAILED"
    case "SUPERSEDED":
      return "SUPERSEDED"
    default:
      return lifecycle.draft?.id === row.id ? "DRAFT" : "OLD_DRAFT"
  }
}

export type ScopeCheck = (config: KnowledgeVersionConfig | null) => Promise<boolean>

/** O histórico da base, da versão mais nova para a mais antiga. Versão fora do alcance de quem lê aparece só com número e situação. */
export async function listKnowledgeVersions(db: Queryable, documentId: string, canRead: ScopeCheck) {
  const rows = (await db.query<HistoryRow>(
    `select v.id, v.version, v.status, v.origin, v.text_status, v.config, v.change_summary, v.created_at, v.created_by_name, v.updated_at, v.updated_by_name,
            v.publish_requested_at, v.publish_requested_by_name, v.published_at, v.published_by_name, v.reactivation_confirmed_at, v.reactivation_confirmed_by_name, v.processing_error_code, v.processing_error_message, v.superseded_reason,
            source.version reverted_from_version,
            (select count(*)::int from knowledge_version_usages u where u.version_id = v.id) usage_count,
            (select max(u.created_at) from knowledge_version_usages u where u.version_id = v.id) last_used_at
       from knowledge_versions v
       left join knowledge_versions source on source.id = v.reverted_from_version_id
      where v.document_id = $1 order by v.version desc`,
    [documentId],
  )).rows
  const lifecycle = lifecycleOf(rows)
  return Promise.all(rows.map(async (row) => {
    const base = { id: row.id, number: row.version, status: row.status, situation: situationOf(row, lifecycle), createdAt: row.created_at, publishedAt: row.published_at }
    if (!(await canRead(parseKnowledgeVersionConfig(row.config)))) return { ...base, restricted: true as const }
    return {
      ...base,
      restricted: false as const,
      origin: row.origin,
      authorName: row.created_by_name ?? row.updated_by_name,
      updatedAt: row.updated_at,
      updatedByName: row.updated_by_name,
      publishRequestedAt: row.publish_requested_at,
      publishRequestedByName: row.publish_requested_by_name,
      publishedByName: row.published_by_name,
      reactivationConfirmedAt: row.reactivation_confirmed_at,
      reactivationConfirmedByName: row.reactivation_confirmed_by_name,
      changeSummary: row.change_summary,
      revertedFromNumber: row.reverted_from_version,
      errorCode: row.processing_error_code,
      errorMessage: row.processing_error_message,
      supersededReason: row.superseded_reason,
      textAvailable: row.text_status === "AVAILABLE",
      hasConfig: row.config !== null,
      usageCount: row.usage_count,
      lastUsedAt: row.last_used_at,
    }
  }))
}

export type KnowledgeVersionDetail = {
  id: string
  number: number
  status: string
  content: string
  textAvailable: boolean
  config: KnowledgeVersionConfig | null
  fileId: string | null
  changeSummary: string | null
  publishedAt: Date | null
  extraction: PdfExtraction | null
}

export async function loadKnowledgeVersion(db: Queryable, organizationId: string, documentId: string, versionId: string): Promise<KnowledgeVersionDetail | null> {
  const row = (await db.query<{ id: string; version: number; status: string; content: string; text_status: string; config: unknown; file_id: string | null; change_summary: string | null; published_at: Date | null; extraction: unknown }>(
    `select v.id, v.version, v.status, v.content, v.text_status, v.config, v.file_id, v.change_summary, v.published_at, v.extraction
       from knowledge_versions v join knowledge_documents d on d.id = v.document_id
      where v.id = $1 and v.document_id = $2 and v.organization_id = $3 and d.deleted_at is null`,
    [versionId, documentId, organizationId],
  )).rows[0]
  if (!row) return null
  return { id: row.id, number: row.version, status: row.status, content: row.content, textAvailable: row.text_status === "AVAILABLE", config: parseKnowledgeVersionConfig(row.config), fileId: row.file_id, changeSummary: row.change_summary, publishedAt: row.published_at, extraction: parseKnowledgeExtraction(row.extraction) }
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = { PROCEDURE: "Procedimento", MANUAL: "Manual", FAQ: "Perguntas frequentes", RULE: "Regra", FLOW: "Fluxo" }

/** Nomes de Grupo, Subgrupo, assunto e produto citados nas configurações (só da organização). */
async function loadConfigNames(db: Queryable, organizationId: string, configs: readonly KnowledgeVersionConfig[]) {
  const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))]
  const teamIds = unique(configs.flatMap((config) => config.orgScopes.map((scope) => scope.teamId)))
  const subteamIds = unique(configs.flatMap((config) => config.orgScopes.map((scope) => scope.subteamId)))
  const subjectIds = unique(configs.flatMap((config) => config.subjectScopes.map((scope) => scope.subjectId)))
  const nodeIds = unique(configs.flatMap((config) => config.productNodeIds))
  const names = async (table: string, ids: string[]) => new Map(ids.length === 0 ? [] : (await db.query<{ id: string; name: string }>(`select id, name from ${table} where organization_id = $1 and id = any($2::uuid[])`, [organizationId, ids])).rows.map((row) => [row.id, row.name]))
  return { teams: await names("teams", teamIds), subteams: await names("subteams", subteamIds), subjects: await names("subjects", subjectIds), products: await names("product_catalog_nodes", nodeIds) }
}

export type KnowledgeFileComparison = {
  change: "NONE" | "ADDED" | "REMOVED" | "REPLACED" | "UNCHANGED"
  from: { filename: string | null; sizeBytes: number | null } | null
  to: { filename: string | null; sizeBytes: number | null } | null
}

export type KnowledgeVersionComparison = {
  from: { id: string; number: number; status: string }
  to: { id: string; number: number; status: string }
  configuration: { comparable: true; changes: ConfigDiffRow[] } | { comparable: false; reason: "NOT_RECORDED"; versions: number[] }
  file: KnowledgeFileComparison
  content: ({ comparable: true; identical: boolean } & TextDiff) | { comparable: false; reason: "TEXT_UNAVAILABLE" | "TOO_LARGE"; versions: number[] }
  /** Mesmo arquivo, conversão diferente: as linhas mudam de forma sem o texto mudar. Só aqui a tela diz quantas palavras de fato mudaram. */
  reconversion: ({ from: string | null; to: string | null } & WordDiff) | null
}

/** Compara duas versões: conteúdo (lado a lado) e configuração, em linguagem de tela. Diz quando alguma parte não pode ser comparada. */
export async function compareKnowledgeVersions(db: Queryable, organizationId: string, from: KnowledgeVersionDetail, to: KnowledgeVersionDetail): Promise<KnowledgeVersionComparison> {
  const configs = [from.config, to.config].filter((config): config is KnowledgeVersionConfig => config !== null)
  const names = await loadConfigNames(db, organizationId, configs)
  const scopeLabel = (scope: KnowledgeVersionConfig["orgScopes"][number]) => scope.scopeType === "ALL_TEAMS" ? "Todos os grupos" : scope.scopeType === "TEAM" ? `Grupo ${names.teams.get(scope.teamId ?? "") ?? "removido"}` : `Subgrupo ${names.subteams.get(scope.subteamId ?? "") ?? "removido"}`
  const subjectLabel = (scope: KnowledgeVersionConfig["subjectScopes"][number]) => scope.scopeType === "ALL_SUBJECTS" ? "Todos os assuntos" : `Assunto ${names.subjects.get(scope.subjectId ?? "") ?? "removido"}`
  const productLabels = (config: KnowledgeVersionConfig) => config.productNodeIds.length === 0 ? ["Todos os produtos"] : config.productNodeIds.map((id) => names.products.get(id) ?? "Produto removido")
  const configuration: KnowledgeVersionComparison["configuration"] = from.config && to.config
    ? {
        comparable: true,
        changes: [
          diffConfigField("title", "Título", [from.config.title], [to.config.title]),
          diffConfigField("documentType", "Tipo", [DOCUMENT_TYPE_LABELS[from.config.documentType] ?? from.config.documentType], [DOCUMENT_TYPE_LABELS[to.config.documentType] ?? to.config.documentType]),
          diffConfigField("sourceType", "Formato", [from.config.sourceType], [to.config.sourceType]),
          diffConfigField("orgScopes", "Alcance", from.config.orgScopes.map(scopeLabel), to.config.orgScopes.map(scopeLabel)),
          diffConfigField("subjectScopes", "Assuntos", from.config.subjectScopes.map(subjectLabel), to.config.subjectScopes.map(subjectLabel)),
          diffConfigField("products", "Vale para (produtos)", productLabels(from.config), productLabels(to.config)),
        ].filter((row): row is ConfigDiffRow => row !== null),
      }
    : { comparable: false, reason: "NOT_RECORDED", versions: [...(from.config ? [] : [from.number]), ...(to.config ? [] : [to.number])] }

  // Sem configuração registrada, o arquivo da versão ainda é conhecido quando ela guarda o vínculo; os dados dele vêm do registro do arquivo.
  const fileOf = async (version: KnowledgeVersionDetail) => {
    if (version.config) return version.config.file ? { checksum: version.config.file.checksum, filename: version.config.file.filename, sizeBytes: version.config.file.sizeBytes } : null
    if (!version.fileId) return null
    const row = (await db.query<{ checksum: string; size: number }>(`select checksum, octet_length(file_data) size from knowledge_files where id = $1`, [version.fileId])).rows[0]
    return row ? { checksum: row.checksum, filename: null, sizeBytes: row.size } : null
  }
  const [fromFile, toFile] = await Promise.all([fileOf(from), fileOf(to)])
  const summary = (file: Awaited<ReturnType<typeof fileOf>>) => (file ? { filename: file.filename, sizeBytes: file.sizeBytes } : null)
  const file: KnowledgeFileComparison = {
    change: !fromFile && !toFile ? "NONE" : !fromFile ? "ADDED" : !toFile ? "REMOVED" : fromFile.checksum === toFile.checksum ? "UNCHANGED" : "REPLACED",
    from: summary(fromFile),
    to: summary(toFile),
  }

  const withoutText = [from, to].filter((version) => !version.textAvailable).map((version) => version.number)
  const diff = withoutText.length === 0 ? diffText(from.content, to.content) : null
  const content: KnowledgeVersionComparison["content"] = withoutText.length > 0
    ? { comparable: false, reason: "TEXT_UNAVAILABLE", versions: withoutText }
    : diff
      ? { comparable: true, identical: diff.added + diff.removed + diff.changed === 0, ...diff }
      : { comparable: false, reason: "TOO_LARGE", versions: [from.number, to.number] }

  const reconversion = file.change === "UNCHANGED" && from.extraction?.version !== to.extraction?.version && withoutText.length === 0
    ? { from: from.extraction?.version ?? null, to: to.extraction?.version ?? null, ...diffWords(from.content, to.content) }
    : null

  const identity = (version: KnowledgeVersionDetail) => ({ id: version.id, number: version.number, status: version.status })
  return { from: identity(from), to: identity(to), configuration, file, content, reconversion }
}
