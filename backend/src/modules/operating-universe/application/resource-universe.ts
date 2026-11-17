import type { Database } from "../../../infrastructure/database/pool.js"
import type { Permission } from "../../access/domain/permissions.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { isOperatingUniverse, type OperatingUniverse } from "../domain/operating-universe.js"
import { existingUniverseConflicts } from "./universe-links.js"

/**
 * RECURSOS COM UNIVERSO — um registro único de quais objetos pertencem a um universo, quem os administra e com quais outros objetos eles
 * se ligam. Universos são mundos SEPARADOS: nenhum vínculo atravessa universos (agente B2B não usa base B2C, Orquestrador B2C não chama
 * agente B2B, Workflow B2X não cita indicador B2B, base B2B não vale para produto B2C…). Pendente (nulo) não conflita: é pendência a
 * classificar, e com a exigência ativa fica fora da operação.
 */
type Queryable = Pick<Database, "query">

export const UNIVERSE_RESOURCE_KINDS = ["KNOWLEDGE_DOCUMENT", "WORKFLOW", "PRODUCT", "INDICATOR", "BUSINESS_DOMAIN", "AGENT", "ORCHESTRATOR", "ARGUMENT_SCRIPT"] as const
export type UniverseResourceKind = (typeof UNIVERSE_RESOURCE_KINDS)[number]

type ResourceDefinition = {
  label: string
  /**
   * Leitura e escrita da CLASSIFICAÇÃO — sempre a visão dos não excluídos (migrations 175/177). É a regra do projeto: `<nome>_all` só
   * para carga, upsert (índice parcial), `alter table`, `references`, a própria exclusão lógica e leitura de histórico pelo id; mudar um
   * campo de um objeto VIVO passa pela visão (auto-atualizável), que de propósito não alcança o excluído — item excluído não se
   * classifica (volta por Consultar dados › Itens excluídos). A tabela real dos Workflows, além disso, só é citada onde a guarda de exclusão lógica permite.
   * Toda escrita filtra `organization_id`.
   */
  read: string
  write: string
  name: string
  /** Filtro extra da leitura (produto: só `PRODUCT`; categoria não tem universo). */
  where?: string
  permission: Permission
  /** Escrita só com escopo de organização (catálogos da organização). */
  organizationWide: boolean
}

export const UNIVERSE_RESOURCES: Record<UniverseResourceKind, ResourceDefinition> = {
  KNOWLEDGE_DOCUMENT: { label: "Base de conhecimento", read: "knowledge_documents", write: "knowledge_documents", name: "title", where: "deleted_at is null", permission: "knowledge.manage", organizationWide: false },
  WORKFLOW: { label: "Workflow", read: "workflows", write: "workflows", name: "name", permission: "workflows.manage", organizationWide: false },
  PRODUCT: { label: "Produto", read: "product_catalog_nodes", write: "product_catalog_nodes", name: "name", where: "kind = 'PRODUCT'", permission: "configuration.manage", organizationWide: true },
  INDICATOR: { label: "Indicador", read: "indicator_definitions", write: "indicator_definitions", name: "name", permission: "configuration.manage", organizationWide: true },
  BUSINESS_DOMAIN: { label: "Domínio de negócio", read: "business_domains", write: "business_domains", name: "name", permission: "configuration.manage", organizationWide: true },
  AGENT: { label: "Agente", read: "agents", write: "agents", name: "name", permission: "agents.manage", organizationWide: false },
  ORCHESTRATOR: { label: "Orquestrador", read: "assistant_orchestrators", write: "assistant_orchestrators", name: "name", permission: "agents.manage", organizationWide: false },
  ARGUMENT_SCRIPT: { label: "Argumentário", read: "argument_scripts", write: "argument_scripts", name: "name", permission: "configuration.manage", organizationWide: false },
}

export type LinkedResource = { kind: UniverseResourceKind | "PRODUCT_VIA_CATEGORY"; id: string; name: string; operatingUniverse: OperatingUniverse | null }
export type ResourceConflict = { kind: UniverseResourceKind; id: string; name: string; operatingUniverse: OperatingUniverse }

const asUniverse = (value: string | null | undefined): OperatingUniverse | null => (isOperatingUniverse(value) ? value : null)

// Grafos de Workflow que contam: rascunho e versão em uso (versões antigas em execução continuam como estavam — histórico).
const WORKFLOW_GRAPHS = `(select w.id, w.draft_graph doc from workflows w where w.organization_id = $1
   union all select w.id, w.draft_trigger_config from workflows w where w.organization_id = $1 and w.draft_trigger_config is not null
   union all select w.id, v.graph from workflows w join workflow_versions v on v.id = w.active_version_id where w.organization_id = $1)`

/** Vizinhos (com universo) de um recurso — tudo o que ele usa e tudo o que o usa. */
const NEIGHBORS: Record<UniverseResourceKind, string> = {
  KNOWLEDGE_DOCUMENT: `
    select 'AGENT' kind, a.id, a.name, a.operating_universe from agent_knowledge_documents akd join agents a on a.id = akd.agent_id where akd.knowledge_document_id = $2 and a.organization_id = $1`,
  AGENT: `
    select 'KNOWLEDGE_DOCUMENT' kind, kd.id, kd.title name, kd.operating_universe from agent_knowledge_documents akd join knowledge_documents kd on kd.id = akd.knowledge_document_id and kd.deleted_at is null where akd.agent_id = $2
    union all select 'BUSINESS_DOMAIN', d.id, d.name, d.operating_universe from agents a join business_domains d on d.id = a.business_domain_id where a.id = $2 and a.organization_id = $1
    union all select 'ORCHESTRATOR', o.id, o.name, o.operating_universe from assistant_orchestrator_specialists s join assistant_orchestrators o on o.id = s.orchestrator_id where s.agent_id = $2 and o.organization_id = $1
    union all select 'ORCHESTRATOR', o.id, o.name, o.operating_universe from assistant_orchestrators o where o.orchestrator_agent_id = $2 and o.organization_id = $1
    union all select distinct 'WORKFLOW', w.id, w.name, w.operating_universe from ${WORKFLOW_GRAPHS} g join workflows w on w.id = g.id
      where jsonb_path_exists(g.doc, '$.** ? (@.agentId == $id)', jsonb_build_object('id', $2::text))`,
  ORCHESTRATOR: `
    select 'AGENT' kind, a.id, a.name, a.operating_universe from assistant_orchestrator_specialists s join agents a on a.id = s.agent_id where s.orchestrator_id = $2 and a.organization_id = $1
    union all select 'AGENT', a.id, a.name, a.operating_universe from assistant_orchestrators o join agents a on a.id = o.orchestrator_agent_id where o.id = $2 and o.organization_id = $1
    union all select 'BUSINESS_DOMAIN', d.id, d.name, d.operating_universe from assistant_orchestrator_domains od join business_domains d on d.id = od.business_domain_id where od.orchestrator_id = $2
    union all select distinct 'WORKFLOW', w.id, w.name, w.operating_universe from ${WORKFLOW_GRAPHS} g join workflows w on w.id = g.id
      where jsonb_path_exists(g.doc, '$.** ? (@.orchestratorId == $id)', jsonb_build_object('id', $2::text))`,
  BUSINESS_DOMAIN: `
    select 'AGENT' kind, a.id, a.name, a.operating_universe from agents a where a.business_domain_id = $2 and a.organization_id = $1
    union all select 'ORCHESTRATOR', o.id, o.name, o.operating_universe from assistant_orchestrator_domains od join assistant_orchestrators o on o.id = od.orchestrator_id where od.business_domain_id = $2 and o.organization_id = $1`,
  INDICATOR: `
    select distinct 'WORKFLOW' kind, w.id, w.name, w.operating_universe from ${WORKFLOW_GRAPHS} g join workflows w on w.id = g.id
      where jsonb_path_exists(g.doc, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', (select code from indicator_definitions where id = $2)))`,
  WORKFLOW: `
    with docs as (select g.doc from ${WORKFLOW_GRAPHS} g where g.id = $2)
    select distinct 'AGENT' kind, a.id, a.name, a.operating_universe from docs, agents a where a.organization_id = $1 and jsonb_path_exists(docs.doc, '$.** ? (@.agentId == $id)', jsonb_build_object('id', a.id::text))
    union all select distinct 'ORCHESTRATOR', o.id, o.name, o.operating_universe from docs, assistant_orchestrators o where o.organization_id = $1 and jsonb_path_exists(docs.doc, '$.** ? (@.orchestratorId == $id)', jsonb_build_object('id', o.id::text))
    union all select distinct 'INDICATOR', i.id, i.name, i.operating_universe from docs, indicator_definitions i where i.organization_id = $1 and jsonb_path_exists(docs.doc, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', i.code))`,
  // Produto × bases/argumentários: pela abrangência por produto em vigor (inclusive pela categoria) — universe-links.ts.
  PRODUCT: `select null::text kind, null::uuid id, null::text name, null::text operating_universe where false and $1::uuid is not null and $2::uuid is not null`,
  ARGUMENT_SCRIPT: `select null::text kind, null::uuid id, null::text name, null::text operating_universe where false and $1::uuid is not null and $2::uuid is not null`,
}

export type CrossUniverseLink = {
  from: { kind: "AGENT" | "ORCHESTRATOR" | "WORKFLOW"; id: string; name: string; operatingUniverse: OperatingUniverse }
  to: { kind: UniverseResourceKind; id: string; name: string; operatingUniverse: OperatingUniverse }
}

/**
 * TODOS os vínculos atuais entre universos diferentes, do lado de "quem usa" (agente → base/domínio; Orquestrador → agente/domínio;
 * Workflow → agente/Orquestrador/indicador), numa consulta só para a organização inteira — a mesma relação de `NEIGHBORS`, sem uma
 * consulta por recurso (a prontidão fazia N+1 com `jsonb_path_exists` de cada grafo contra cada agente/Orquestrador/indicador). Os ids
 * citados nos grafos são extraídos UMA vez por documento (`$.**.agentId` etc.) e cruzados por igualdade. Cada vínculo aparece uma vez.
 */
export async function crossUniverseLinks(db: Queryable, organizationId: string): Promise<CrossUniverseLink[]> {
  const rows = (await db.query<{ from_kind: CrossUniverseLink["from"]["kind"]; from_id: string; from_name: string; from_universe: string; to_kind: UniverseResourceKind; to_id: string; to_name: string; to_universe: string }>(
    `with graphs as ${WORKFLOW_GRAPHS},
     cited as (
       select distinct g.id graph_owner_id, 'AGENT' kind, v #>> '{}' ref from graphs g, jsonb_path_query(g.doc, 'lax $.**.agentId[*]') v
       union select distinct g.id, 'ORCHESTRATOR', v #>> '{}' from graphs g, jsonb_path_query(g.doc, 'lax $.**.orchestratorId[*]') v
       union select distinct g.id, 'INDICATOR', v #>> '{}' from graphs g, jsonb_path_query(g.doc, 'lax $.**.indicatorCode[*]') v
     ),
     links as (
       select 'AGENT' from_kind, a.id from_id, a.name from_name, a.operating_universe from_universe, 'KNOWLEDGE_DOCUMENT' to_kind, kd.id to_id, kd.title to_name, kd.operating_universe to_universe
         from agents a join agent_knowledge_documents akd on akd.agent_id = a.id join knowledge_documents kd on kd.id = akd.knowledge_document_id and kd.deleted_at is null
        where a.organization_id = $1
       union select 'AGENT', a.id, a.name, a.operating_universe, 'BUSINESS_DOMAIN', d.id, d.name, d.operating_universe
         from agents a join business_domains d on d.id = a.business_domain_id where a.organization_id = $1
       union select 'ORCHESTRATOR', o.id, o.name, o.operating_universe, 'AGENT', a.id, a.name, a.operating_universe
         from assistant_orchestrators o join assistant_orchestrator_specialists s on s.orchestrator_id = o.id join agents a on a.id = s.agent_id and a.organization_id = $1
        where o.organization_id = $1
       union select 'ORCHESTRATOR', o.id, o.name, o.operating_universe, 'AGENT', a.id, a.name, a.operating_universe
         from assistant_orchestrators o join agents a on a.id = o.orchestrator_agent_id where o.organization_id = $1
       union select 'ORCHESTRATOR', o.id, o.name, o.operating_universe, 'BUSINESS_DOMAIN', d.id, d.name, d.operating_universe
         from assistant_orchestrators o join assistant_orchestrator_domains od on od.orchestrator_id = o.id join business_domains d on d.id = od.business_domain_id
        where o.organization_id = $1
       union select 'WORKFLOW', w.id, w.name, w.operating_universe, 'AGENT', a.id, a.name, a.operating_universe
         from cited c join workflows w on w.id = c.graph_owner_id join agents a on a.organization_id = $1 and a.id::text = c.ref where c.kind = 'AGENT'
       union select 'WORKFLOW', w.id, w.name, w.operating_universe, 'ORCHESTRATOR', o.id, o.name, o.operating_universe
         from cited c join workflows w on w.id = c.graph_owner_id join assistant_orchestrators o on o.organization_id = $1 and o.id::text = c.ref where c.kind = 'ORCHESTRATOR'
       union select 'WORKFLOW', w.id, w.name, w.operating_universe, 'INDICATOR', i.id, i.name, i.operating_universe
         from cited c join workflows w on w.id = c.graph_owner_id join indicator_definitions i on i.organization_id = $1 and i.code = c.ref where c.kind = 'INDICATOR'
     )
     select * from links
      where from_universe is not null and to_universe is not null and from_universe <> to_universe
      order by case from_kind when 'AGENT' then 0 when 'ORCHESTRATOR' then 1 else 2 end, from_name, from_id, to_kind, to_name, to_id`,
    [organizationId],
  )).rows
  return rows.map((row) => ({
    from: { kind: row.from_kind, id: row.from_id, name: row.from_name, operatingUniverse: row.from_universe as OperatingUniverse },
    to: { kind: row.to_kind, id: row.to_id, name: row.to_name, operatingUniverse: row.to_universe as OperatingUniverse },
  }))
}

export async function linkedResources(db: Queryable, organizationId: string, kind: UniverseResourceKind, id: string): Promise<LinkedResource[]> {
  const rows = (await db.query<{ kind: UniverseResourceKind; id: string; name: string; operating_universe: string | null }>(NEIGHBORS[kind], [organizationId, id])).rows
  return rows.map((row) => ({ kind: row.kind, id: row.id, name: row.name, operatingUniverse: asUniverse(row.operating_universe) }))
}

/** Vínculos que FICARIAM com universos diferentes se o recurso tivesse `universe` (inclui produtos pela abrangência em vigor). */
export async function resourceLinkConflicts(db: Queryable, organizationId: string, kind: UniverseResourceKind, id: string, universe: OperatingUniverse | null): Promise<ResourceConflict[]> {
  if (universe === null) return []
  const direct = (await linkedResources(db, organizationId, kind, id))
    .filter((linked) => linked.operatingUniverse !== null && linked.operatingUniverse !== universe)
    .map((linked) => ({ kind: linked.kind as UniverseResourceKind, id: linked.id, name: linked.name, operatingUniverse: linked.operatingUniverse! }))
  if (kind === "KNOWLEDGE_DOCUMENT" || kind === "ARGUMENT_SCRIPT") {
    const products = await existingUniverseConflicts(db, organizationId, { sourceId: id, overrideSourceUniverse: universe })
    direct.push(...products.map((conflict) => ({ kind: "PRODUCT" as const, id: conflict.productId, name: conflict.productName, operatingUniverse: conflict.productUniverse! })))
  }
  if (kind === "PRODUCT") {
    const sources = await existingUniverseConflicts(db, organizationId, { productId: id, overrideProductUniverse: universe })
    direct.push(...sources.map((conflict) => ({ kind: conflict.sourceKind, id: conflict.sourceId, name: conflict.sourceName, operatingUniverse: conflict.sourceUniverse! })))
  }
  return [...new Map(direct.map((conflict) => [`${conflict.kind}:${conflict.id}`, conflict])).values()]
}

export function resourceConflictError(kind: UniverseResourceKind, conflicts: readonly ResourceConflict[]): DomainError {
  const lines = conflicts.slice(0, 10).map((conflict) => `${UNIVERSE_RESOURCES[conflict.kind].label} "${conflict.name}" (${conflict.operatingUniverse})`)
  return new DomainError(
    `${UNIVERSE_RESOURCES[kind].label} e recursos ligados ficariam em universos diferentes — universos não se misturam. Resolva estes vínculos antes de salvar: ${lines.join("; ")}${conflicts.length > 10 ? ` e mais ${conflicts.length - 10}` : ""}.`,
    "OPERATING_UNIVERSE_LINK_CONFLICT",
    409,
    { conflicts },
  )
}

/** Depois de gravar vínculos (dentro da transação de quem salva): se algum atravessa universos, recusa — e a transação desfaz. */
export async function assertResourceLinksCompatible(db: Queryable, organizationId: string, kind: UniverseResourceKind, id: string): Promise<void> {
  const def = UNIVERSE_RESOURCES[kind]
  const universe = asUniverse((await db.query<{ operating_universe: string | null }>(`select operating_universe from ${def.read} where id = $1 and organization_id = $2`, [id, organizationId])).rows[0]?.operating_universe)
  const conflicts = await resourceLinkConflicts(db, organizationId, kind, id, universe)
  if (conflicts.length > 0) throw resourceConflictError(kind, conflicts)
}

export async function resourceUniverse(db: Queryable, organizationId: string, kind: UniverseResourceKind, id: string): Promise<OperatingUniverse | null> {
  const def = UNIVERSE_RESOURCES[kind]
  return asUniverse((await db.query<{ operating_universe: string | null }>(`select operating_universe from ${def.read} where id = $1 and organization_id = $2`, [id, organizationId])).rows[0]?.operating_universe)
}

/**
 * Publicação de Workflow: agentes, Orquestradores e indicadores citados no GRAFO (e no gatilho) que está sendo publicado precisam ser do
 * universo do Workflow. Com a exigência ativa, citar recurso pendente também recusa (ele está fora da operação).
 */
export async function assertWorkflowGraphUniverse(db: Queryable, organizationId: string, documents: readonly unknown[], universe: OperatingUniverse | null, enforced: boolean): Promise<void> {
  if (universe === null) {
    if (enforced) throw new DomainError("Escolha o universo de atuação (B2B, B2C ou B2X) do Workflow antes de publicar.", "OPERATING_UNIVERSE_REQUIRED", 422)
    return
  }
  const rows = (await db.query<{ kind: UniverseResourceKind; id: string; name: string; operating_universe: string | null }>(
    `with docs as (select value doc from jsonb_array_elements($2::jsonb))
     select distinct 'AGENT' kind, a.id, a.name, a.operating_universe from docs, agents a where a.organization_id = $1 and jsonb_path_exists(docs.doc, '$.** ? (@.agentId == $id)', jsonb_build_object('id', a.id::text))
     union select distinct 'ORCHESTRATOR', o.id, o.name, o.operating_universe from docs, assistant_orchestrators o where o.organization_id = $1 and jsonb_path_exists(docs.doc, '$.** ? (@.orchestratorId == $id)', jsonb_build_object('id', o.id::text))
     union select distinct 'INDICATOR', i.id, i.name, i.operating_universe from docs, indicator_definitions i where i.organization_id = $1 and jsonb_path_exists(docs.doc, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', i.code))`,
    [organizationId, JSON.stringify(documents.filter((doc) => doc !== null && doc !== undefined))],
  )).rows
  const conflicts = rows
    .filter((row) => (row.operating_universe === null ? enforced : row.operating_universe !== universe))
    .map((row) => ({ kind: row.kind, id: row.id, name: row.name, operatingUniverse: (row.operating_universe ?? "PENDENTE") as OperatingUniverse }))
  if (conflicts.length > 0) throw resourceConflictError("WORKFLOW", conflicts)
}
