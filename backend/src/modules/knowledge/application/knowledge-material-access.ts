import type { Database } from "../../../infrastructure/database/pool.js"
import { visibilityOf } from "../../access/application/access-service.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import type { PdfExtraction } from "../domain/pdf-markdown/layout.js"
import { parseKnowledgeExtraction } from "./knowledge-versions.js"
import { liveKnowledgeVersion } from "./live-knowledge-version.js"

/**
 * Autorização de LEITURA de um material da Base de Conhecimento por quem não é Admin — a mesma
 * regra para a página do material (`/materiais/:id`), para o link dentro de um Feedback e para a
 * checagem "o destinatário poderá abrir?" feita ao persistir uma recomendação da IA.
 *
 * Fonte da regra: o ALCANCE já cadastrado da base (`knowledge_document_org_scopes`, "Todos os
 * grupos" / Grupo / Subgrupo) — não existe uma segunda lista de permissões. Um material é acessível
 * ao leitor quando, cumulativamente:
 *   1. pertence à organização do leitor (material de outra organização é invisível, mesmo com id válido);
 *   2. não foi excluído (`deleted_at`) e a versão VIGENTE está PUBLISHED. Vigente = a mais recente já decidida (publicada
 *      ou arquivada); rascunho/aprovada ainda não publicada fica de fora (`LIVE_VERSION`). Assim um rascunho em edição não
 *      tira do ar a versão publicada — a mesma que os Agents usam (`retrieve-knowledge.ts`) — e arquivar tira. Antes valia a
 *      versão mais recente de qualquer status: salvar um rascunho escondia a base do esclarecimento no chat/voz e o
 *      material dos Feedbacks dava 404 (validação funcional de 20/10/2026);
 *   3. o alcance cobre o leitor: Todos os grupos; ou o Grupo/Subgrupo do próprio leitor; ou o
 *      Grupo/Subgrupo de alguém ativo abaixo dele na cadeia real de `reports_to_id` (gestão lê o
 *      material do time que lidera); ou a CONTA do leitor tem `knowledge.manage` num escopo que cobre o
 *      alcance da base (organização inteira = qualquer base; Grupo/Subgrupo = bases daquele Grupo/Subgrupo). Base sem
 *      alcance cadastrado = só quem administra bases na organização inteira (nunca "aberto por omissão"). V1.5.8: o nível
 *      hierárquico (inclusive o legado "ADMIN") não concede leitura.
 *
 * Uma referência num Feedback NÃO concede acesso: quem perdeu o alcance depois deixa de ver o link.
 */
export type KnowledgeMaterialViewer = { personId: string }

export type AccessibleKnowledgeMaterial = {
  id: string
  title: string
  documentType: string
  sourceType: string
}

/** A versão vigente do documento `d` (ver regra 2 e `live-knowledge-version.ts`). */
const LIVE_VERSION = liveKnowledgeVersion("d.id", "id, content, version, extraction")

const ACCESS_CLAUSE = `
  exists (select 1 from chain)
  and (
    $3::boolean
    or exists (
      select 1 from knowledge_document_org_scopes s
      where s.knowledge_document_id = d.id
        and ((s.scope_type = 'TEAM' and s.team_id = any($5::uuid[])) or (s.scope_type = 'SUBTEAM' and (s.subteam_id = any($6::uuid[]) or s.subteam_id in (select id from subteams where team_id = any($5::uuid[])))))
    )
    or exists (
      select 1 from knowledge_document_org_scopes s
      where s.knowledge_document_id = d.id
        and (
          s.scope_type = 'ALL_TEAMS'
          or (s.scope_type = 'TEAM' and s.team_id in (select team_id from reachable where team_id is not null))
          or (s.scope_type = 'SUBTEAM' and s.subteam_id in (select subteam_id from reachable where subteam_id is not null))
        )
    )
  )`

/** Leitor + todos os ativos abaixo dele (`union` corta ciclos), com Grupo/Subgrupo de cada um. A
 * âncora exige que o leitor seja uma pessoa DESTA organização — sem isso, nada é acessível
 * (defesa em profundidade além do token). */
const REACHABLE_CTE = `
  with recursive chain as (
    select p.id, p.team_id, p.subteam_id from people p where p.id = $2 and p.organization_id = $1
    union
    select p.id, p.team_id, p.subteam_id from people p join chain on p.reports_to_id = chain.id where p.organization_id = $1 and p.active
  ), reachable as (select team_id, subteam_id from chain)`

/**
 * Dos ids pedidos, devolve só os materiais que o leitor pode abrir (mapa por id). Uma consulta para
 * N materiais — o feed de Acompanhamento resolve todos os Feedbacks da página de uma vez.
 */
export async function resolveAccessibleKnowledgeMaterials(
  db: Pick<Database, "query">,
  input: { organizationId: string; viewer: KnowledgeMaterialViewer; materialIds: string[] },
): Promise<Map<string, AccessibleKnowledgeMaterial>> {
  const accessible = new Map<string, AccessibleKnowledgeMaterial>()
  const ids = [...new Set(input.materialIds.filter(isUuid))]
  if (ids.length === 0) return accessible
  const result = await db.query<AccessibleKnowledgeMaterial>(
    `${REACHABLE_CTE}
     select d.id, d.title, d.document_type "documentType", d.source_type "sourceType"
     from knowledge_documents d
     join lateral (${LIVE_VERSION}) lv on true
     where d.organization_id = $1 and d.deleted_at is null and d.id = any($4::uuid[]) and lv.status = 'PUBLISHED'
       and ${ACCESS_CLAUSE}`,
    [input.organizationId, input.viewer.personId, ...(await knowledgeManagerParams(db, input.organizationId, input.viewer.personId, ids))],
  )
  for (const row of result.rows) accessible.set(row.id, row)
  return accessible
}

export type KnowledgeMaterialDetail = AccessibleKnowledgeMaterial & {
  originalFilename: string | null
  mimeType: string | null
  fileSizeBytes: number | null
  updatedAt: string
  /** Conteúdo da versão PUBLICADA (nunca um rascunho mais novo). */
  content: string
  version: number
  /** A versão vigente: quem chega por uma citação confere se a página citada é desta versão. */
  versionId: string
  /** Registro da conversão do PDF (páginas e imagens no texto); null fora disso. */
  extraction: PdfExtraction | null
}

/** Página do material: detalhe + conteúdo publicado, ou null quando não existe/não acessível (o
 * chamador responde 404 sem distinguir "não existe" de "sem acesso"). */
export async function loadAccessibleKnowledgeMaterial(
  db: Pick<Database, "query">,
  input: { organizationId: string; viewer: KnowledgeMaterialViewer; materialId: string },
): Promise<KnowledgeMaterialDetail | null> {
  if (!isUuid(input.materialId)) return null
  const result = await db.query<Omit<KnowledgeMaterialDetail, "extraction"> & { extraction?: unknown }>(
    `${REACHABLE_CTE}
     select d.id, d.title, d.document_type "documentType", d.source_type "sourceType",
            d.original_filename "originalFilename", d.mime_type "mimeType", d.file_size_bytes "fileSizeBytes",
            coalesce(d.updated_at, d.created_at) "updatedAt", lv.content, lv.version, lv.id "versionId", lv.extraction
     from knowledge_documents d
     join lateral (${LIVE_VERSION}) lv on true
     where d.organization_id = $1 and d.deleted_at is null and d.id = $4 and lv.status = 'PUBLISHED'
       and ${ACCESS_CLAUSE}`,
    [input.organizationId, input.viewer.personId, ...(await knowledgeManagerParams(db, input.organizationId, input.viewer.personId, input.materialId))],
  )
  const row = result.rows[0]
  return row ? { ...row, extraction: parseKnowledgeExtraction(row.extraction) } : null
}

/** Só a versão vigente de um material que o leitor pode abrir, sem o texto: é o que cada imagem de uma página precisa conferir. Mesma regra de acesso. */
export async function resolveAccessibleMaterialVersion(
  db: Pick<Database, "query">,
  input: { organizationId: string; viewer: KnowledgeMaterialViewer; materialId: string },
): Promise<string | null> {
  if (!isUuid(input.materialId)) return null
  const result = await db.query<{ versionId: string }>(
    `${REACHABLE_CTE}
     select lv.id "versionId"
     from knowledge_documents d
     join lateral (${LIVE_VERSION}) lv on true
     where d.organization_id = $1 and d.deleted_at is null and d.id = $4 and lv.status = 'PUBLISHED'
       and ${ACCESS_CLAUSE}`,
    [input.organizationId, input.viewer.personId, ...(await knowledgeManagerParams(db, input.organizationId, input.viewer.personId, input.materialId))],
  )
  return result.rows[0]?.versionId ?? null
}

/** `$3..$6`: onde a CONTA do leitor administra bases (`knowledge.manage` pelas atribuições de papel) + o `$4` da consulta. */
async function knowledgeManagerParams(db: Pick<Database, "query">, organizationId: string, personId: string, fourth: unknown): Promise<[boolean, unknown, string[], string[]]> {
  const visibility = visibilityOf(await createPostgresAccessRepository(db).loadContextByPerson(organizationId, personId), "knowledge.manage")
  return [visibility.organizationWide, fourth, visibility.teamIds, visibility.subteamIds]
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
