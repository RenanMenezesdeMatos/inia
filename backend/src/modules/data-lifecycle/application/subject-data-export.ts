import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { transcriptForModel } from "../../workflows/application/transcript.js"

/**
 * EXPORTAÇÃO DOS DADOS DE UMA PESSOA (pedido do titular, LGPD art. 18 — direito de acesso). Quem exporta é o Administrador
 * geral (permissão `privacy.subject_data.export`); o arquivo vai para o Privacy conferir antes de entregar ao titular.
 *
 * COMPLETA POR CONSTRUÇÃO: as tabelas não são listadas à mão. A exportação lê do próprio banco (pg_constraint) toda coluna com
 * chave estrangeira para `people` e devolve as linhas que apontam para a pessoa; depois faz o mesmo, um nível abaixo, para o que
 * é DELA e tem filhos (contas de acesso, interações/chamadas, conversas com a INIA). Uma tabela nova que referenciar a pessoa
 * entra sozinha.
 *
 * Fica de fora o que não é dado da pessoa: colunas de senha, segredo, token e hash saem como "[omitido]". As transcrições saem
 * com CPF, telefone, e-mail e protocolo DO CLIENTE mascarados (são dados de terceiros); o original continua no banco.
 */
export const SUBJECT_DATA_EXPORT_VERSION = "SUBJECT_DATA_EXPORT_V1"
const ROW_LIMIT = 5_000
const OMITTED_COLUMN = /(password|secret|token|hash|ciphertext|nonce|api_key|private_key)/i
const OMITTED = "[omitido]"

type Queryable = Pick<Database, "query">
type Link = { table: string; column: string }
export type ExportSection = { table: string; via: string; rows: Record<string, unknown>[]; truncated: boolean }
export type SubjectDataExport = {
  version: string
  generatedAt: string
  organizationId: string
  person: Record<string, unknown>
  sections: ExportSection[]
  notes: string[]
}

/** Pais de segundo nível: o que é DA pessoa e tem filhos com dados dela (coluna que liga o pai à pessoa). */
const OWNED_PARENTS: { table: string; ownerColumn: string; label: string }[] = [
  { table: "user_accounts", ownerColumn: "person_id", label: "conta de acesso" },
  { table: "interactions", ownerColumn: "operator_id", label: "interação (chamada)" },
  { table: "assistant_conversations", ownerColumn: "owner_person_id", label: "conversa com a INIA" },
]

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

async function linksTo(db: Queryable, parent: string): Promise<Link[]> {
  const result = await db.query<{ table_name: string; column_name: string }>(
    `select c.conrelid::regclass::text table_name, a.attname column_name
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = $1::regclass and array_length(c.conkey, 1) = 1
      order by 1, 2`,
    [parent],
  )
  return result.rows.map((row) => ({ table: row.table_name, column: row.column_name }))
}

async function hasOrganizationColumn(db: Queryable, table: string, cache: Map<string, boolean>): Promise<boolean> {
  if (!cache.has(table)) {
    const result = await db.query(`select 1 from pg_attribute where attrelid = $1::regclass and attname = 'organization_id' and not attisdropped`, [table])
    cache.set(table, (result.rowCount ?? 0) > 0)
  }
  return cache.get(table)!
}

function sanitize(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [column, value] of Object.entries(row)) {
    if (OMITTED_COLUMN.test(column)) clean[column] = value === null ? null : OMITTED
    else if (table === "transcripts" && column === "content" && typeof value === "string") clean[column] = transcriptForModel(value)
    else clean[column] = value
  }
  return clean
}

async function readSection(db: Queryable, link: Link, ids: readonly string[], organizationId: string, via: string, orgCache: Map<string, boolean>): Promise<ExportSection | null> {
  if (ids.length === 0) return null
  const withOrganization = await hasOrganizationColumn(db, link.table, orgCache)
  const result = await db.query<Record<string, unknown>>(
    `select * from ${link.table.split(".").map(quoteIdent).join(".")} where ${quoteIdent(link.column)} = any($1::uuid[])${withOrganization ? " and organization_id = $2" : ""} limit ${ROW_LIMIT + 1}`,
    withOrganization ? [ids, organizationId] : [ids],
  )
  if (result.rows.length === 0) return null
  return { table: link.table, via, rows: result.rows.slice(0, ROW_LIMIT).map((row) => sanitize(link.table, row)), truncated: result.rows.length > ROW_LIMIT }
}

export async function exportSubjectData(db: Queryable, input: { organizationId: string; personId: string; actorPersonId: string; at?: Date }): Promise<SubjectDataExport> {
  const at = input.at ?? new Date()
  const person = (await db.query<Record<string, unknown>>(`select * from people where id = $1 and organization_id = $2`, [input.personId, input.organizationId])).rows[0]
  if (!person) throw new DomainError("Pessoa não encontrada.", "PERSON_NOT_FOUND", 404)
  const orgCache = new Map<string, boolean>()
  const sections: ExportSection[] = []

  for (const link of await linksTo(db, "people")) {
    const section = await readSection(db, link, [input.personId], input.organizationId, `${link.column} = a pessoa`, orgCache)
    if (section) sections.push(section)
  }
  for (const parent of OWNED_PARENTS) {
    const exists = (await db.query(`select to_regclass($1) is not null ok`, [parent.table])).rows[0] as { ok: boolean } | undefined
    if (!exists?.ok) continue
    const owned = (await db.query<{ id: string }>(`select id from ${quoteIdent(parent.table)} where ${quoteIdent(parent.ownerColumn)} = $1`, [input.personId])).rows.map((row) => row.id)
    for (const link of await linksTo(db, parent.table)) {
      const section = await readSection(db, link, owned, input.organizationId, `${link.column} = ${parent.label} da pessoa`, orgCache)
      if (section) sections.push(section)
    }
  }

  const totalRows = sections.reduce((sum, section) => sum + section.rows.length, 0)
  await db.query(
    `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at)
     values ($1, $2, 'PERSONAL_DATA_EXPORTED', 'person', $3, $4, $5)`,
    [input.organizationId, input.actorPersonId, input.personId, JSON.stringify({ version: SUBJECT_DATA_EXPORT_VERSION, tables: sections.length, rows: totalRows, truncatedTables: sections.filter((section) => section.truncated).map((section) => section.table) }), at],
  )

  return {
    version: SUBJECT_DATA_EXPORT_VERSION,
    generatedAt: at.toISOString(),
    organizationId: input.organizationId,
    person: sanitize("people", person),
    sections,
    notes: [
      "Dados ligados à pessoa no banco da INIA, encontrados pelas chaves do próprio banco (toda tabela que referencia a pessoa, e um nível abaixo para as contas de acesso, as interações e as conversas com a INIA).",
      "Senhas, segredos, tokens e hashes aparecem como [omitido].",
      "Nas transcrições, CPF, telefone, e-mail e protocolo do CLIENTE estão mascarados (são dados de terceiros).",
      "Linhas em que a pessoa aparece como autora de uma ação (ex.: auditoria, revisões) podem mencionar outras pessoas: o Privacy confere antes de entregar ao titular.",
      `No máximo ${ROW_LIMIT} linhas por tabela; tabelas cortadas estão marcadas com truncated = true.`,
    ],
  }
}
