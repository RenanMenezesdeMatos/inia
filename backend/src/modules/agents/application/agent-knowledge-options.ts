import type { Database } from "../../../infrastructure/database/pool.js"
import { escapeLike, SqlFilter } from "../../../shared/presentation/list-query.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { knowledgeFitsAgentSql } from "../../knowledge/application/knowledge-agent-fit.js"
import { readableDocumentSql } from "../../knowledge/application/knowledge-document-read-access.js"
import { foldSearchTerm, foldSql, type KnowledgeOptionsCursor } from "../domain/knowledge-options-cursor.js"

/**
 * SELETOR DE BASES DO AGENT (Administração › Agentes › Criar/Editar). Com ~1000 bases grandes a lista não pode vir inteira nem trazer
 * conteúdo: aqui só o que a escolha precisa (título, universo, situação, Grupos, assuntos e produtos), com busca e filtros no SQL e
 * página por posição (keyset em `(título dobrado, id)`, `limit + 1`). As mesmas condições servem à lista, aos ids filtrados
 * ("selecionar as filtradas" e a pré-seleção pelo Grupo do agente) e à leitura das escolhidas pelo id.
 *
 * O que a tela oferece segue as regras de quem SALVA (`agent-config-rules.ts` e `knowledge-agent-fit.ts`): universo do agente (base pendente cabe), e para agente de
 * Grupo/Subgrupo só bases globais ou do mesmo Grupo. O que já está ligado e saiu dessas regras continua visível pela leitura por id.
 * Visibilidade: o alcance de `agents.manage` de quem pede, com a mesma regra de leitura da lista de Bases (global, Grupo, Subgrupo ou o
 * Grupo-pai de um Subgrupo administrado).
 */

export type KnowledgeOptionState = "IN_USE" | "ARCHIVED" | "NO_VERSION"
export type KnowledgeOptionScope = { scopeType: string; teamId: string | null; teamName: string | null; subteamId: string | null; subteamName: string | null }
export type KnowledgeOption = {
  id: string
  title: string
  operatingUniverse: string | null
  state: KnowledgeOptionState
  inUseVersion: number | null
  orgScopes: KnowledgeOptionScope[]
  allSubjects: boolean
  subjects: string[]
  products: string[]
}

export type AgentScope = { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId?: string | undefined; subteamId?: string | undefined }

export type KnowledgeOptionsFilter = {
  search?: string | undefined
  /** Universo do agente: só bases dele ou pendentes. Ausente = sem restrição (agente ainda pendente). */
  agentUniverse?: string | undefined
  /** Filtro "Universo" do seletor: um universo ou PENDING (sem classificação). */
  universe?: string | undefined
  /** Alcance do agente: Grupo/Subgrupo só aceita base global ou do mesmo Grupo (a regra do salvar). */
  agentScope?: AgentScope | undefined
  /** Filtro de Grupo/Subgrupo do seletor (vínculo da própria base). */
  scopeType?: "ALL_TEAMS" | undefined
  teamId?: string | undefined
  subteamId?: string | undefined
  productId?: string | undefined
  subjectScopeType?: "ALL_SUBJECTS" | undefined
  subjectId?: string | undefined
  state?: KnowledgeOptionState | undefined
  excludeIds?: readonly string[] | undefined
}

const SCOPE_EXISTS = (condition: string) => `exists (select 1 from knowledge_document_org_scopes os where os.knowledge_document_id = d.id and (${condition}))`
/** Produtos vigentes da base (a mesma vigência de `knowledgeProductsSql`). */
const PRODUCT_ASSIGNMENT = `product_scope_assignments a where a.organization_id = d.organization_id and a.source_kind = 'KNOWLEDGE_DOCUMENT' and a.source_id = d.id and a.effective_until is null and a.effective_from <= now()`
/** Versão em uso (ou arquivada) da base — a mesma de `KNOWLEDGE_SELECT`. */
const LIVE_JOIN = `left join lateral (select v.status, v.version from knowledge_versions v where v.document_id = d.id and v.status in ('PUBLISHED', 'ARCHIVED') order by v.version desc limit 1) live on true`
const STATE_SQL = `case when live.status = 'PUBLISHED' then 'IN_USE' when live.status = 'ARCHIVED' then 'ARCHIVED' else 'NO_VERSION' end`
export const TITLE_KEY_SQL = foldSql("d.title")

/** Condições sobre `knowledge_documents d` (sem ordem nem posição). `$1` = organização. */
export function knowledgeOptionsWhere(organizationId: string, scopes: ManageableScopes, filter: KnowledgeOptionsFilter): SqlFilter {
  const sql = new SqlFilter([organizationId])
  const readable = readableDocumentSql("d.id", scopes, (value) => sql.param(value))
  if (readable) sql.add(readable)
  if (filter.agentUniverse) sql.add(`(d.operating_universe is null or d.operating_universe = ${sql.param(filter.agentUniverse)})`)
  if (filter.universe === "PENDING") sql.add(`d.operating_universe is null`)
  else if (filter.universe) sql.add(`d.operating_universe = ${sql.param(filter.universe)}`)
  const agentScope = filter.agentScope
  if (agentScope && agentScope.scopeType !== "ALL_TEAMS") {
    sql.add(knowledgeFitsAgentSql("d.id", { scopeType: `${sql.param(agentScope.scopeType)}::text`, teamId: `${sql.param(agentScope.teamId ?? null)}::uuid`, subteamId: `${sql.param(agentScope.subteamId ?? null)}::uuid` }))
  }
  if (filter.subteamId) {
    const subteam = sql.param(filter.subteamId)
    sql.add(SCOPE_EXISTS(`os.subteam_id = ${subteam}::uuid or (os.scope_type = 'TEAM' and os.team_id = (select st.team_id from subteams st where st.id = ${subteam}::uuid))`))
  } else if (filter.teamId) {
    sql.add(SCOPE_EXISTS(`os.team_id = ${sql.param(filter.teamId)}::uuid`))
  } else if (filter.scopeType === "ALL_TEAMS") {
    sql.add(SCOPE_EXISTS(`os.scope_type = 'ALL_TEAMS'`))
  }
  if (filter.subjectId) sql.add(`exists (select 1 from knowledge_document_subject_scopes ss where ss.knowledge_document_id = d.id and ss.subject_id = ${sql.param(filter.subjectId)}::uuid)`)
  else if (filter.subjectScopeType === "ALL_SUBJECTS") sql.add(`exists (select 1 from knowledge_document_subject_scopes ss where ss.knowledge_document_id = d.id and ss.scope_type = 'ALL_SUBJECTS')`)
  // Produto: o nó escolhido ou, sendo família, qualquer produto dela.
  if (filter.productId) {
    const product = sql.param(filter.productId)
    sql.add(`exists (select 1 from ${PRODUCT_ASSIGNMENT} and a.node_ids && array(select n.id from product_catalog_nodes n where n.id = ${product}::uuid or n.parent_id = ${product}::uuid))`)
  }
  if (filter.state) sql.add(`(${STATE_SQL}) = ${sql.param(filter.state)}`)
  if (filter.excludeIds?.length) sql.add(`d.id <> all(${sql.param([...filter.excludeIds])}::uuid[])`)
  // Busca: título, nome do arquivo, assunto e produto — sem acento nem caixa.
  const term = filter.search ? foldSearchTerm(filter.search) : ""
  if (term) {
    const like = sql.param(`%${escapeLike(term)}%`)
    sql.add(`(${foldSql("d.title")} like ${like} or ${foldSql("coalesce(d.original_filename, '')")} like ${like}
      or exists (select 1 from knowledge_document_subject_scopes ss join interaction_subject_definitions sub on sub.id = ss.subject_id where ss.knowledge_document_id = d.id and ${foldSql("sub.name")} like ${like})
      or exists (select 1 from ${PRODUCT_ASSIGNMENT} and exists (select 1 from product_catalog_nodes n left join product_catalog_nodes p on p.id = n.parent_id where n.id = any(a.node_ids) and (${foldSql("n.name")} like ${like} or ${foldSql("coalesce(p.name, '')")} like ${like}))))`)
  }
  return sql
}

const FROM = `from knowledge_documents d ${LIVE_JOIN}`
const BASE_WHERE = `d.organization_id = $1 and d.deleted_at is null`
const whereOf = (sql: SqlFilter) => {
  const extra = sql.where()
  return extra ? `${extra} and ${BASE_WHERE}` : ` where ${BASE_WHERE}`
}

/** Colunas leves da linha (só para os itens da página: Grupos, assuntos e produtos depois do LIMIT). */
const OPTION_COLUMNS = `
  d.id, d.title, d.operating_universe "operatingUniverse", ${STATE_SQL} state,
  case when live.status = 'PUBLISHED' then live.version end "inUseVersion",
  coalesce((select json_agg(json_build_object('scopeType', os.scope_type, 'teamId', os.team_id, 'teamName', t.name, 'subteamId', os.subteam_id, 'subteamName', st.name) order by t.name nulls first, st.name nulls first)
    from knowledge_document_org_scopes os left join teams t on t.id = os.team_id left join subteams st on st.id = os.subteam_id where os.knowledge_document_id = d.id), '[]') "orgScopes",
  exists (select 1 from knowledge_document_subject_scopes ss where ss.knowledge_document_id = d.id and ss.scope_type = 'ALL_SUBJECTS') "allSubjects",
  coalesce((select json_agg(sub.name order by sub.name) from knowledge_document_subject_scopes ss join interaction_subject_definitions sub on sub.id = ss.subject_id where ss.knowledge_document_id = d.id), '[]') subjects,
  coalesce((select json_agg(case when p.id is null then n.name else p.name || ' › ' || n.name end order by coalesce(p.name, n.name), n.name)
    from product_scope_assignments a cross join unnest(a.node_ids) as nid(id) join product_catalog_nodes n on n.id = nid.id and n.active left join product_catalog_nodes p on p.id = n.parent_id
    where a.organization_id = d.organization_id and a.source_kind = 'KNOWLEDGE_DOCUMENT' and a.source_id = d.id and a.effective_until is null and a.effective_from <= now()), '[]') products`

export const KNOWLEDGE_OPTIONS_MAX_LIMIT = 100
export const KNOWLEDGE_OPTION_IDS_CAP = 2000

export type KnowledgeOptionsPage = { items: KnowledgeOption[]; nextCursor: KnowledgeOptionsCursor | null; total: number | null }

/** Uma página da lista. `total` só na primeira página (sem cursor): a contagem é do filtro, não da página. */
export async function listKnowledgeOptions(
  db: Pick<Database, "query">,
  organizationId: string,
  scopes: ManageableScopes,
  filter: KnowledgeOptionsFilter,
  page: { cursor: KnowledgeOptionsCursor | null; limit: number },
): Promise<KnowledgeOptionsPage> {
  const sql = knowledgeOptionsWhere(organizationId, scopes, filter)
  const total = page.cursor ? null : Number((await db.query<{ total: string }>(`select count(*) total ${FROM}${whereOf(sql)}`, sql.params)).rows[0]?.total ?? 0)
  if (page.cursor) sql.add(`(${TITLE_KEY_SQL}, d.id) > (${sql.param(page.cursor.key)}, ${sql.param(page.cursor.id)}::uuid)`)
  const limit = Math.min(Math.max(page.limit, 1), KNOWLEDGE_OPTIONS_MAX_LIMIT)
  // Ordem e posição primeiro (só chave + id), conteúdo das linhas depois do LIMIT.
  const rows = (await db.query<KnowledgeOption & { titleKey: string }>(
    `with page as (select d.id, ${TITLE_KEY_SQL} "titleKey" ${FROM}${whereOf(sql)} order by ${TITLE_KEY_SQL}, d.id limit ${limit + 1})
     select page."titleKey", ${OPTION_COLUMNS} from page join knowledge_documents d on d.id = page.id ${LIVE_JOIN} order by page."titleKey", page.id`,
    sql.params,
  )).rows
  const items = rows.slice(0, limit)
  const last = items[items.length - 1]
  return {
    items: items.map(({ titleKey, ...item }) => (void titleKey, item)),
    nextCursor: rows.length > limit && last ? { key: last.titleKey, id: last.id } : null,
    total,
  }
}

/** Ids do filtro, em ordem de título, até o teto ("selecionar as filtradas" e pré-seleção pelo Grupo). */
export async function knowledgeOptionIds(db: Pick<Database, "query">, organizationId: string, scopes: ManageableScopes, filter: KnowledgeOptionsFilter): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  const sql = knowledgeOptionsWhere(organizationId, scopes, filter)
  const rows = (await db.query<{ id: string; total: string }>(`select d.id, count(*) over () total ${FROM}${whereOf(sql)} order by ${TITLE_KEY_SQL}, d.id limit ${KNOWLEDGE_OPTION_IDS_CAP}`, sql.params)).rows
  const total = Number(rows[0]?.total ?? 0)
  return { ids: rows.map((row) => row.id), total, truncated: total > rows.length }
}

/**
 * Bases que o Grupo do agente já traz (regra de sempre do formulário): globais e, para agente de Grupo, as vinculadas ao Grupo (inclusive
 * por Subgrupo); para agente de Subgrupo, as vinculadas ao próprio Subgrupo. Agente "todos os Grupos" não pré-seleciona nada.
 */
export async function groupDefaultKnowledgeIds(db: Pick<Database, "query">, organizationId: string, scopes: ManageableScopes, agentScope: AgentScope, agentUniverse: string | undefined): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  if (agentScope.scopeType === "ALL_TEAMS") return { ids: [], total: 0, truncated: false }
  const sql = knowledgeOptionsWhere(organizationId, scopes, { agentUniverse })
  const condition = agentScope.scopeType === "SUBTEAM" ? `os.subteam_id = ${sql.param(agentScope.subteamId ?? null)}::uuid` : `os.team_id = ${sql.param(agentScope.teamId ?? null)}::uuid`
  sql.add(SCOPE_EXISTS(`os.scope_type = 'ALL_TEAMS' or ${condition}`))
  const rows = (await db.query<{ id: string; total: string }>(`select d.id, count(*) over () total ${FROM}${whereOf(sql)} order by ${TITLE_KEY_SQL}, d.id limit ${KNOWLEDGE_OPTION_IDS_CAP}`, sql.params)).rows
  const total = Number(rows[0]?.total ?? 0)
  return { ids: rows.map((row) => row.id), total, truncated: total > rows.length }
}

/** As escolhidas pelo id (inclusive inativas e de outro universo — nunca somem), no alcance de leitura de quem pede. */
export async function lookupKnowledgeOptions(db: Pick<Database, "query">, organizationId: string, scopes: ManageableScopes, ids: readonly string[]): Promise<KnowledgeOption[]> {
  if (ids.length === 0) return []
  const sql = knowledgeOptionsWhere(organizationId, scopes, {})
  sql.add(`d.id = any(${sql.param([...ids])}::uuid[])`)
  return (await db.query<KnowledgeOption>(`select ${OPTION_COLUMNS} ${FROM}${whereOf(sql)} order by ${TITLE_KEY_SQL}, d.id`, sql.params)).rows
}

export type KnowledgeOptionFacets = { products: { id: string; name: string; parentId: string | null; parentName: string | null }[]; subjects: { id: string; name: string }[] }

/** Opções dos filtros Produto e Assunto: só os que aparecem em alguma base que quem pede enxerga (no universo do agente). */
export async function knowledgeOptionFacets(db: Pick<Database, "query">, organizationId: string, scopes: ManageableScopes, agentUniverse: string | undefined): Promise<KnowledgeOptionFacets> {
  const sql = knowledgeOptionsWhere(organizationId, scopes, { agentUniverse })
  const visible = `select d.id, d.organization_id ${FROM}${whereOf(sql)}`
  const [products, subjects] = await Promise.all([
    db.query<KnowledgeOptionFacets["products"][number]>(
      `with visible as (${visible})
       select distinct n.id, n.name, p.id "parentId", p.name "parentName"
         from visible d join product_scope_assignments a on a.organization_id = d.organization_id and a.source_kind = 'KNOWLEDGE_DOCUMENT' and a.source_id = d.id and a.effective_until is null and a.effective_from <= now()
         cross join unnest(a.node_ids) as nid(id) join product_catalog_nodes n on n.id = nid.id and n.active left join product_catalog_nodes p on p.id = n.parent_id
        order by p.name nulls first, n.name`,
      sql.params,
    ),
    db.query<KnowledgeOptionFacets["subjects"][number]>(
      `with visible as (${visible})
       select distinct sub.id, sub.name from visible d join knowledge_document_subject_scopes ss on ss.knowledge_document_id = d.id join interaction_subject_definitions sub on sub.id = ss.subject_id order by sub.name`,
      sql.params,
    ),
  ])
  return { products: products.rows, subjects: subjects.rows }
}
