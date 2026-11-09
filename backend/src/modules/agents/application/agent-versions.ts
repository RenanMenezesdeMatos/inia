import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AGENT_LIVE_COLUMNS, configFromLiveRow, parseAgentConfig, sameAgentConfig, type AgentConfig, type AgentLiveRow, type AgentRuntimeSnapshot } from "../domain/agent-config.js"

/**
 * Rascunho, publicação e versões do agente (PEN-002, decidida em 03/11/2026; migration 164).
 * - As colunas de `agents` + `agent_knowledge_documents` espelham a VERSÃO VIGENTE (`current_version_id`).
 * - O rascunho fica em `agents.draft_config`, protegido por `draft_revision` contra sobrescrita silenciosa (PEN-050).
 * - Publicar e reverter criam uma linha nova e IMUTÁVEL em `agent_versions` (o banco recusa UPDATE e DELETE direto).
 * Publicar nunca muda `active` (item 8) e nunca atualiza Workflows ou orquestradores que fixam outra versão (item 6, PEN-076).
 */

type Queryable = Pick<Database, "query">

export type AgentActor = { personId: string | null; name: string }

export type AgentVersionSummary = {
  id: string
  number: number
  origin: "MIGRATION" | "PUBLISH" | "REVERT"
  revertedFromNumber: number | null
  publishedAt: string
  publishedByName: string
  current: boolean
}

export type AgentDraftState = {
  config: AgentConfig
  revision: number
  updatedAt: string | null
  updatedByName: string | null
}

export type AgentLifecycleRow = {
  id: string
  organizationId: string
  active: boolean
  currentVersionId: string | null
  currentVersionNumber: number | null
  draftConfig: AgentConfig | null
  draftRevision: number
  draftUpdatedAt: string | null
  draftUpdatedByName: string | null
  scopeType: string
  teamId: string | null
  subteamId: string | null
}

/** Estado de ciclo de vida do agente. `forUpdate` trava a linha (publicar, reverter, salvar rascunho, excluir). */
export async function loadAgentLifecycle(db: Queryable, organizationId: string, agentId: string, options: { forUpdate?: boolean } = {}): Promise<AgentLifecycleRow | null> {
  const result = await db.query<Omit<AgentLifecycleRow, "draftConfig"> & { draftConfig: unknown }>(
    `select a.id, a.organization_id "organizationId", a.active, a.current_version_id "currentVersionId",
            (select v.version_number from agent_versions v where v.id = a.current_version_id) "currentVersionNumber",
            a.draft_config "draftConfig", a.draft_revision "draftRevision", a.draft_updated_at "draftUpdatedAt", a.draft_updated_by_name "draftUpdatedByName",
            a.scope_type "scopeType", a.team_id "teamId", a.subteam_id "subteamId"
       from agents a where a.id = $1 and a.organization_id = $2 ${options.forUpdate ? "for update of a" : ""}`,
    [agentId, organizationId],
  )
  const row = result.rows[0]
  if (!row) return null
  return { ...row, draftConfig: row.draftConfig ? parseAgentConfig(row.draftConfig) : null }
}

/** Configuração viva (= versão vigente; num agente nunca publicado, a configuração inicial gravada na criação). */
export async function loadLiveAgentConfig(db: Queryable, organizationId: string, agentId: string): Promise<AgentConfig | null> {
  const row = (await db.query<AgentLiveRow>(`select ${AGENT_LIVE_COLUMNS} from agents where id = $1 and organization_id = $2`, [agentId, organizationId])).rows[0]
  if (!row) return null
  const knowledge = await db.query<{ knowledge_document_id: string }>(`select knowledge_document_id from agent_knowledge_documents where agent_id = $1`, [agentId])
  return configFromLiveRow(row, knowledge.rows.map((item) => item.knowledge_document_id))
}

/** O que o formulário edita: o rascunho, se houver; senão a configuração viva. */
export async function loadEditableAgentConfig(db: Queryable, organizationId: string, agentId: string): Promise<{ config: AgentConfig; lifecycle: AgentLifecycleRow } | null> {
  const lifecycle = await loadAgentLifecycle(db, organizationId, agentId)
  if (!lifecycle) return null
  const config = lifecycle.draftConfig ?? (await loadLiveAgentConfig(db, organizationId, agentId))
  return config ? { config, lifecycle } : null
}

/** Alcance da configuração de uma versão (sem o resto dela): a lista diz a quem lê se pode abri-la, testá-la ou revertê-la. */
export type AgentVersionScope = Pick<AgentConfig, "scopeType" | "teamId" | "subteamId">

export async function listAgentVersions(db: Queryable, organizationId: string, agentId: string): Promise<(AgentVersionSummary & { scope: AgentVersionScope })[]> {
  const result = await db.query<AgentVersionSummary & { scope: AgentVersionScope }>(
    `select v.id, v.version_number "number", v.origin, rv.version_number "revertedFromNumber", v.published_at "publishedAt", v.published_by_name "publishedByName",
            (a.current_version_id = v.id) "current",
            jsonb_build_object('scopeType', v.config->>'scopeType', 'teamId', v.config->>'teamId', 'subteamId', v.config->>'subteamId') "scope"
       from agent_versions v join agents a on a.id = v.agent_id
       left join agent_versions rv on rv.id = v.reverted_from_version_id
      where v.agent_id = $1 and v.organization_id = $2
      order by v.version_number desc`,
    [agentId, organizationId],
  )
  return result.rows
}

export async function loadAgentVersion(db: Queryable, organizationId: string, agentId: string, versionId: string): Promise<{ summary: AgentVersionSummary; config: AgentConfig } | null> {
  const result = await db.query<AgentVersionSummary & { config: unknown }>(
    `select v.id, v.version_number "number", v.origin, rv.version_number "revertedFromNumber", v.published_at "publishedAt", v.published_by_name "publishedByName",
            (a.current_version_id = v.id) "current", v.config
       from agent_versions v join agents a on a.id = v.agent_id
       left join agent_versions rv on rv.id = v.reverted_from_version_id
      where v.id = $1 and v.agent_id = $2 and v.organization_id = $3`,
    [versionId, agentId, organizationId],
  )
  const row = result.rows[0]
  if (!row) return null
  const { config, ...summary } = row
  return { summary, config: parseAgentConfig(config) }
}

/** Grava a configuração nas colunas vivas e nos vínculos com as bases (publicar/reverter; criação). */
export async function writeLiveAgentConfig(client: Queryable, organizationId: string, agentId: string, config: AgentConfig): Promise<void> {
  await client.query(
    `update agents set name = $3, agent_type = $4, objective = $5, description = $6, context_prompt = $7, scope_type = $8, team_id = $9, subteam_id = $10,
            specialty = $11, specialty_kind = $12, domain = $13, capability = $14, consolidated_input = $15, business_domain_id = $16,
            recommend_support_materials = $17, investigation_capabilities = $18::text[], action_limits_enabled = $19, action_limits = $20, updated_at = now()
      where id = $1 and organization_id = $2`,
    [agentId, organizationId, config.name, config.agentType, config.objective, config.description, config.contextPrompt, config.scopeType, config.teamId, config.subteamId,
      config.specialty, config.specialtyKind, config.domain, config.capability, config.consolidatedInput, config.businessDomainId,
      config.recommendSupportMaterials, config.investigationCapabilities, config.actionLimitsEnabled, config.actionLimits],
  )
  await client.query(`delete from agent_knowledge_documents where agent_id = $1`, [agentId])
  for (const knowledgeDocumentId of [...new Set(config.knowledgeDocumentIds)]) {
    await client.query(`insert into agent_knowledge_documents(agent_id, knowledge_document_id) values ($1, $2)`, [agentId, knowledgeDocumentId])
  }
}

async function insertVersion(client: Queryable, organizationId: string, agentId: string, config: AgentConfig, actor: AgentActor, origin: "PUBLISH" | "REVERT", revertedFromVersionId: string | null) {
  const next = await client.query<{ next: number }>(`select coalesce(max(version_number), 0) + 1 "next" from agent_versions where agent_id = $1`, [agentId])
  const created = await client.query<{ id: string; number: number }>(
    `insert into agent_versions (organization_id, agent_id, version_number, config, origin, reverted_from_version_id, published_by_person_id, published_by_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, version_number "number"`,
    [organizationId, agentId, next.rows[0]!.next, JSON.stringify(config), origin, revertedFromVersionId, actor.personId, actor.name],
  )
  await client.query(`update agents set current_version_id = $1 where id = $2`, [created.rows[0]!.id, agentId])
  return created.rows[0]!
}

/** PEN-050: o pedido diz em qual revisão do rascunho se baseou; se outra pessoa gravou depois, nada é gravado. */
export function assertDraftRevision(lifecycle: AgentLifecycleRow, expected: number | undefined): void {
  if (expected === undefined || expected === lifecycle.draftRevision) return
  throw new DomainError(
    "Outra pessoa alterou o rascunho deste agente depois que você o abriu. Atualize para ver a versão atual; o que você digitou continua na tela.",
    "AGENT_DRAFT_CONFLICT",
    409,
    { draftRevision: lifecycle.draftRevision, draftUpdatedAt: lifecycle.draftUpdatedAt, draftUpdatedByName: lifecycle.draftUpdatedByName },
  )
}

/** Grava o rascunho (item 1: sem afetar a versão em uso). Igual à versão vigente = sem rascunho pendente. */
export async function saveAgentDraft(client: Queryable, lifecycle: AgentLifecycleRow, config: AgentConfig, actor: AgentActor): Promise<{ revision: number }> {
  const live = lifecycle.currentVersionId ? await loadLiveAgentConfig(client, lifecycle.organizationId, lifecycle.id) : null
  const pending = !live || !sameAgentConfig(live, config)
  const updated = await client.query<{ revision: number }>(
    `update agents set draft_config = $3, draft_revision = draft_revision + 1, draft_updated_at = now(), draft_updated_by_name = $4
      where id = $1 and organization_id = $2 returning draft_revision "revision"`,
    [lifecycle.id, lifecycle.organizationId, pending ? JSON.stringify(config) : null, actor.name],
  )
  return { revision: updated.rows[0]!.revision }
}

/** Itens 2 e 8: publica o rascunho como versão nova, imutável e vigente. Não mexe em `active`. */
export async function publishAgentDraft(client: Queryable, lifecycle: AgentLifecycleRow, actor: AgentActor): Promise<{ id: string; number: number }> {
  if (!lifecycle.draftConfig) {
    throw new DomainError("Não há alterações em rascunho para publicar.", "AGENT_NOTHING_TO_PUBLISH", 409)
  }
  await writeLiveAgentConfig(client, lifecycle.organizationId, lifecycle.id, lifecycle.draftConfig)
  const version = await insertVersion(client, lifecycle.organizationId, lifecycle.id, lifecycle.draftConfig, actor, "PUBLISH", null)
  await client.query(`update agents set draft_config = null, draft_revision = draft_revision + 1, draft_updated_at = now(), draft_updated_by_name = $2 where id = $1`, [lifecycle.id, actor.name])
  return version
}

/**
 * Item 7 + PEN-050: reverter publica a configuração de uma versão anterior como versão NOVA; nenhuma versão é apagada nem alterada.
 * Com rascunho em andamento, só com confirmação explícita — e aí o rascunho é descartado (fica registrado no histórico).
 */
export async function revertAgentToVersion(
  client: Queryable,
  lifecycle: AgentLifecycleRow,
  source: { id: string; config: AgentConfig },
  actor: AgentActor,
  options: { discardDraft: boolean },
): Promise<{ id: string; number: number; discardedDraft: boolean }> {
  if (lifecycle.draftConfig && !options.discardDraft) {
    throw new DomainError(
      "Este agente tem um rascunho em andamento. Reverter publica a configuração escolhida como versão nova e descarta o rascunho — confirme para continuar.",
      "AGENT_DRAFT_PENDING",
      409,
      { draftRevision: lifecycle.draftRevision, draftUpdatedAt: lifecycle.draftUpdatedAt, draftUpdatedByName: lifecycle.draftUpdatedByName },
    )
  }
  await writeLiveAgentConfig(client, lifecycle.organizationId, lifecycle.id, source.config)
  const version = await insertVersion(client, lifecycle.organizationId, lifecycle.id, source.config, actor, "REVERT", source.id)
  await client.query(`update agents set draft_config = null, draft_revision = draft_revision + 1, draft_updated_at = now(), draft_updated_by_name = $2 where id = $1`, [lifecycle.id, actor.name])
  return { ...version, discardedDraft: Boolean(lifecycle.draftConfig) }
}

/** Descarta o rascunho (volta à versão vigente). Agente nunca publicado não tem para onde voltar. */
export async function discardAgentDraft(client: Queryable, lifecycle: AgentLifecycleRow, actor: AgentActor): Promise<void> {
  if (!lifecycle.currentVersionId) throw new DomainError("Este agente ainda não foi publicado: o rascunho é tudo o que existe dele.", "AGENT_NOT_PUBLISHED", 409)
  await client.query(`update agents set draft_config = null, draft_revision = draft_revision + 1, draft_updated_at = now(), draft_updated_by_name = $2 where id = $1`, [lifecycle.id, actor.name])
}

/**
 * Versão a executar — resolvida quando a execução do agente vai começar e registrada nela.
 * Revisão aprovada da PEN-002/PEN-076 (03/11/2026): em produção vale SEMPRE a versão VIGENTE — Workflows e orquestradores não
 * fixam versão de agente; publicar torna a versão nova vigente para as próximas execuções, sem republicar os consumidores.
 * `versionId` existe só para o teste manual de uma versão publicada escolhida (PEN-049). Nunca o rascunho.
 * Agente sem versão publicada não executa em produção (PEN-047).
 */
export async function resolveAgentVersionForRun(db: Queryable, organizationId: string, agentId: string, reference: { versionId?: string | null } = {}): Promise<AgentRuntimeSnapshot & { active: boolean }> {
  const agent = (await db.query<{ active: boolean; current_version_id: string | null }>(`select active, current_version_id from agents where id = $1 and organization_id = $2`, [agentId, organizationId])).rows[0]
  if (!agent) throw new DomainError("Agente não encontrado.", "AGENT_NOT_FOUND", 404)
  const versionQuery = reference.versionId
    ? db.query<{ id: string; version_number: number; config: unknown }>(`select id, version_number, config from agent_versions where id = $1 and agent_id = $2`, [reference.versionId, agentId])
    : agent.current_version_id
      ? db.query<{ id: string; version_number: number; config: unknown }>(`select id, version_number, config from agent_versions where id = $1`, [agent.current_version_id])
      : null
  const version = versionQuery ? (await versionQuery).rows[0] : undefined
  if (!version) {
    if (!agent.current_version_id && !reference.versionId) throw new DomainError("Este agente ainda não foi publicado.", "AGENT_NOT_PUBLISHED", 422)
    throw new DomainError("A versão do agente referenciada não existe.", "AGENT_VERSION_NOT_FOUND", 422)
  }
  return { agentId, organizationId, versionId: version.id, versionNumber: version.version_number, config: parseAgentConfig(version.config), active: agent.active }
}

/** Rascunho para o teste manual (PEN-049). Sem rascunho pendente, o "rascunho" é a configuração viva. */
export async function resolveAgentDraftForTest(db: Queryable, organizationId: string, agentId: string): Promise<AgentRuntimeSnapshot & { active: boolean }> {
  const editable = await loadEditableAgentConfig(db, organizationId, agentId)
  if (!editable) throw new DomainError("Agente não encontrado.", "AGENT_NOT_FOUND", 404)
  return { agentId, organizationId, versionId: null, versionNumber: null, config: editable.config, active: editable.lifecycle.active }
}
