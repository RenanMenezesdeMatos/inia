import { Router, type Request } from "express"
import { z } from "zod"
import { INVESTIGATION_CAPABILITY_LABELS, investigationCapabilitySchema, normalizeCapabilities, type InvestigationCapability } from "../../investigation/domain/capabilities.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { booleanParam, dateParam, listParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { applyManageableScopeFilter, canManageScope, getManageableScopes, normalizeScopedTarget, type ManageableScopes, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { agentBusinessDomainJoin, agentBusinessDomainJson, assertBusinessDomainsSelectable, resolveBusinessDomainRefs } from "../../business-domains/application/business-domain-lookup.js"
import { businessDomainCodeSchema } from "../../business-domains/domain/business-domain.js"
import { agentTextSchema } from "../domain/agent-field-limits.js"
import { actionLimitsProblem, describeActionLimits, type AgentActionLimits } from "../domain/action-limits.js"
import { describeSpecialtyProblem, legacySpecialtyFor, legacySpecialtySchema, resolveAgentSpecialty, specialtyKindSchema, type AgentSpecialty } from "../domain/agent-specialty.js"
import type { AgentConfig } from "../domain/agent-config.js"
import { runAgent } from "../application/run-agent.js"
import { buildSystemPrompt } from "../application/build-system-prompt.js"
import { withAgentSnapshots } from "../application/agent-runtime-context.js"
import {
  assertDraftRevision,
  discardAgentDraft,
  listAgentVersions,
  loadAgentLifecycle,
  loadAgentVersion,
  loadLiveAgentConfig,
  publishAgentDraft,
  resolveAgentDraftForTest,
  revertAgentToVersion,
  saveAgentDraft,
  writeLiveAgentConfig,
  type AgentActor,
  type AgentLifecycleRow,
} from "../application/agent-versions.js"
import { assessAgentDeletion, deleteAgentIfUnused } from "../application/agent-deletion.js"
import { computePublishImpact } from "../application/agent-publish-impact.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Cadastro de agentes. Ciclo de vida decidido em 03/11/2026 (ESP-INIA-03 §4.1):
 * - PEN-002 / PEN-050: alterações vão para um RASCUNHO (revisão otimista contra sobrescrita silenciosa); publicar cria versão
 *   imutável e vigente; reverter publica de novo uma versão anterior como versão nova; publicar não reativa.
 * - PEN-001 / PEN-068: agente INATIVO — listar, consultar o cadastro, ver o histórico completo, reativar e excluir só com
 *   `agents.inactive.manage` (administradores; o mapeamento dos perfis da Vivo é a PEN-032), conferido aqui no servidor.
 * - PEN-001 / PEN-065 / PEN-066 / PEN-069: exclusão só sem histórico de uso e sem dependências (agent-deletion.ts).
 */

/** Prévia da publicação; `versionId` = prévia da reversão para essa versão (reverter também publica). */
const publishImpactQuerySchema = z.object({ versionId: z.string().uuid().optional() })

const testAgentSchema = z.object({
  // Teto: o texto vai inteiro para o provedor de IA (custo) — uma transcrição longa cabe folgada.
  input: z.string().trim().min(10).max(100_000),
  /** PEN-049: o rascunho salvo ou uma versão publicada (padrão: a vigente; sem versão publicada, o rascunho). */
  target: z.enum(["DRAFT", "VERSION"]).optional(),
  versionId: z.string().uuid().optional(),
})

const AGENT_TYPES = ["CALL_FEEDBACK", "INDICATOR_FEEDBACK", "DIAGNOSTICS", "ORCHESTRATOR", "HR", "CUSTOM"] as const

const agentSchema = z.object({
  name: agentTextSchema("name"),
  agentType: z.enum(AGENT_TYPES),
  objective: agentTextSchema("objective"),
  description: agentTextSchema("description"),
  contextPrompt: agentTextSchema("contextPrompt"),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]).default("ALL_TEAMS"),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  knowledgeDocumentIds: z.array(z.string().uuid()).default([]),
  active: z.boolean().optional(),
  // Especialidade — forma alvo (migration 057/060, agents/domain/agent-specialty.ts): tipo +
  // domínio de negócio (só DOMAIN — por id do catálogo em `businessDomainId`, ou por código em
  // `domain` por compatibilidade) + competência (só CROSS_CUTTING) + aceita resultado consolidado.
  // A forma legada `specialty` continua aceita; quando as duas vêm, a nova prevalece e a legada é
  // DERIVADA (dual-write) — nunca gravadas em desacordo.
  specialtyKind: specialtyKindSchema.nullable().optional(),
  businessDomainId: z.string().uuid().nullable().optional(),
  domain: businessDomainCodeSchema.nullable().optional(),
  capability: agentTextSchema("capability").nullable().optional(),
  consolidatedInput: z.boolean().optional(),
  specialty: legacySpecialtySchema.nullable().optional(),
  /** "Quando este Agente responder diretamente, pode recomendar materiais das bases que
   * consultar?" — padrão false; como especialista de Orquestrador ele só fornece candidatos. */
  recommendSupportMaterials: z.boolean().optional(),
  /** Capacidades de investigação (investigation/domain/capabilities.ts) — o Agent é dono das Tools. */
  investigationCapabilities: z.array(investigationCapabilitySchema).optional(),
  /** Limites de atuação (agents/domain/action-limits.ts): interruptor + "até onde este agente vai". Ligado exige texto. */
  actionLimitsEnabled: z.boolean().default(false),
  actionLimits: agentTextSchema("actionLimits").nullable().optional(),
})

const updateAgentSchema = z.object({
  name: agentTextSchema("name").optional(),
  agentType: z.enum(AGENT_TYPES).optional(),
  objective: agentTextSchema("objective").optional(),
  description: agentTextSchema("description").optional(),
  contextPrompt: agentTextSchema("contextPrompt").optional(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]).optional(),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  knowledgeDocumentIds: z.array(z.string().uuid()).optional(),
  /** Ativar/desativar é controle separado da publicação (PEN-002, item 8): vale na hora, sem passar pelo rascunho. */
  active: z.boolean().optional(),
  specialtyKind: specialtyKindSchema.nullable().optional(),
  businessDomainId: z.string().uuid().nullable().optional(),
  domain: businessDomainCodeSchema.nullable().optional(),
  capability: agentTextSchema("capability").nullable().optional(),
  consolidatedInput: z.boolean().optional(),
  specialty: legacySpecialtySchema.nullable().optional(),
  recommendSupportMaterials: z.boolean().optional(),
  investigationCapabilities: z.array(investigationCapabilitySchema).optional(),
  actionLimitsEnabled: z.boolean().optional(),
  actionLimits: agentTextSchema("actionLimits").nullable().optional(),
  /** PEN-050: revisão do rascunho em que a edição se baseou. Diferente da atual = 409 AGENT_DRAFT_CONFLICT, nada gravado. */
  expectedDraftRevision: z.number().int().nonnegative().optional(),
})

const revisionSchema = z.object({ expectedDraftRevision: z.number().int().nonnegative().optional() })
const revertSchema = revisionSchema.extend({ discardDraft: z.boolean().default(false) })
const referencesSchema = z.object({ ids: z.string().optional() })

/** Texto vazio dos limites vira null (o interruptor desligado guarda o texto que houver). */
const actionLimitsText = (value: string | null | undefined) => (value?.trim() ? value.trim() : null)

/** Ligado sem texto: 422 antes de gravar (o banco também recusa — agents_action_limits_check). */
function assertActionLimits(limits: AgentActionLimits) {
  const problem = actionLimitsProblem(limits)
  if (problem) throw new DomainError(problem, "AGENT_ACTION_LIMITS_REQUIRED", 422)
}

type SpecialtyInput = { specialtyKind?: string | null | undefined; businessDomainId?: string | null | undefined; domain?: string | null | undefined; capability?: string | null | undefined; consolidatedInput?: boolean | undefined; specialty?: string | null | undefined }

/**
 * Entrada → especialidade tipada: a forma nova (`specialtyKind`…) prevalece; sem ela, a forma
 * legada (`specialty`) é traduzida pelo dual-read. `current` é o estado persistido (PATCH parcial).
 * O domínio de negócio é SEMPRE resolvido contra o catálogo (`business_domains`): por id
 * (`businessDomainId`), por código (`domain`) ou pelo código legado em `specialty`. Inexistente ⇒
 * 422 BUSINESS_DOMAIN_NOT_FOUND; inativo só passa se for o domínio que o Agent já tinha.
 */
async function specialtyFromInput(db: Pick<Database, "query">, organizationId: string, input: SpecialtyInput, current?: AgentSpecialty): Promise<AgentSpecialty | undefined> {
  const touchesNew = input.specialtyKind !== undefined || input.businessDomainId !== undefined || input.domain !== undefined || input.capability !== undefined || input.consolidatedInput !== undefined
  if (!touchesNew && input.specialty === undefined) return undefined
  const legacyOnly = !touchesNew ? resolveAgentSpecialty({ specialty: input.specialty }) : null
  const base = current ?? { kind: null, domain: null, capability: null, acceptsConsolidated: false }
  const kind = input.specialtyKind !== undefined ? input.specialtyKind : legacyOnly ? legacyOnly.kind : base.kind
  const domainSelector = input.businessDomainId !== undefined || input.domain !== undefined ? { ids: input.businessDomainId ? [input.businessDomainId] : [], codes: !input.businessDomainId && input.domain ? [input.domain] : [] } : legacyOnly ? { codes: legacyOnly.domain ? [legacyOnly.domain.code] : [] } : null
  let domain = base.domain
  if (domainSelector) {
    const refs = await resolveBusinessDomainRefs(db as Database, organizationId, domainSelector)
    assertBusinessDomainsSelectable(refs, base.domain ? [base.domain.code] : [])
    domain = refs[0] ?? null
  }
  const resolved: AgentSpecialty = {
    kind: kind === "DOMAIN" || kind === "CROSS_CUTTING" || kind === "PERFORMANCE" || kind === "SYNTHESIS" ? kind : null,
    domain: kind === "DOMAIN" ? domain : null,
    capability: kind === "CROSS_CUTTING" ? (input.capability !== undefined ? input.capability : base.capability) : null,
    acceptsConsolidated: kind === "SYNTHESIS" || Boolean(input.consolidatedInput ?? base.acceptsConsolidated),
  }
  const problem = describeSpecialtyProblem({ ...resolved, domain: kind === "DOMAIN" ? domain : resolved.domain })
  if (problem) throw new DomainError(problem, "AGENT_SPECIALTY_INVALID", 422)
  return resolved
}

/** Especialidade de uma configuração (rascunho/versão), com o domínio lido do catálogo. */
async function specialtyOfConfig(db: Pick<Database, "query">, config: AgentConfig): Promise<AgentSpecialty> {
  const domain = config.businessDomainId ? (await db.query<{ id: string; code: string; name: string; active: boolean }>(`select id, code, name, active from business_domains where id = $1`, [config.businessDomainId])).rows[0] : undefined
  return resolveAgentSpecialty({
    specialty: config.specialty,
    specialty_kind: config.specialtyKind,
    domain: config.domain,
    capability: config.capability,
    consolidated_input: config.consolidatedInput,
    business_domain_id: domain?.id ?? null,
    business_domain_code: domain?.code ?? null,
    business_domain_name: domain?.name ?? null,
    business_domain_active: domain?.active ?? null,
  })
}

const listAgentsSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  agentType: listParam(z.enum(AGENT_TYPES)),
  active: booleanParam,
  knowledgeDocumentId: z.string().uuid().optional(),
  createdFrom: dateParam,
  createdTo: dateParam,
})

const AGENT_SELECT = `
  select
    a.id, a.name, a.agent_type "agentType", a.objective, a.description, a.context_prompt "contextPrompt",
    a.active, a.created_at "createdAt", a.specialty,
    a.specialty_kind "specialtyKind", a.domain, a.capability, a.consolidated_input "consolidatedInput",
    a.business_domain_id "businessDomainId", ${agentBusinessDomainJson("bd")} "businessDomain",
    a.recommend_support_materials "recommendSupportMaterials",
    coalesce(a.investigation_capabilities, '{}'::text[]) "investigationCapabilities",
    a.action_limits_enabled "actionLimitsEnabled", a.action_limits "actionLimits",
    a.scope_type "scopeType", a.team_id "teamId", t.name "teamName", a.subteam_id "subteamId", st.name "subteamName",
    (select count(*) from agent_runs ar where ar.agent_id = a.id)::int "usageCount",
    cp.name "createdByName",
    a.current_version_id "currentVersionId", cv.version_number "currentVersionNumber", cv.published_at "currentVersionPublishedAt",
    (a.current_version_id is not null) "published", (a.draft_config is not null) "hasDraft",
    a.draft_revision "draftRevision", a.draft_updated_at "draftUpdatedAt", a.draft_updated_by_name "draftUpdatedByName",
    coalesce((
      select json_agg(json_build_object('id', kd.id, 'title', kd.title))
      from agent_knowledge_documents akd
      join knowledge_documents kd on kd.id = akd.knowledge_document_id
      where akd.agent_id = a.id
    ), '[]') "knowledgeDocuments"
  from agents a
  ${agentBusinessDomainJoin("a", "bd")}
  left join agent_versions cv on cv.id = a.current_version_id
  left join teams t on t.id = a.team_id
  left join subteams st on st.id = a.subteam_id
  left join user_accounts ua on ua.id = a.created_by
  left join people cp on cp.id = ua.person_id
  where a.organization_id = $1
`

const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  agentType: "Tipo",
  objective: "Objetivo",
  description: "Descrição",
  contextPrompt: "Contexto",
  active: "Status",
  scopeType: "Alcance",
  knowledgeDocumentIds: "Bases de conhecimento",
  actionLimits: "Limites de atuação",
  investigationCapabilities: "Ferramentas de investigação",
  specialty: "Especialidade",
  recommendSupportMaterials: "Recomendar materiais",
  version: "Versão",
  draft: "Rascunho",
}

type FieldChange = { field: string; label: string; from: string; to: string }

function diffIdList(field: string, before: string[], after: string[]): FieldChange | null {
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  if (!added.length && !removed.length) return null
  const parts: string[] = []
  if (added.length) parts.push(`+${added.length}`)
  if (removed.length) parts.push(`-${removed.length}`)
  return { field, label: FIELD_LABELS[field]!, from: "", to: parts.join(" ") }
}

const capabilityLabel = (list: string[]) => (list.length === 0 ? "Nenhuma" : list.map((capability) => INVESTIGATION_CAPABILITY_LABELS[capability as InvestigationCapability] ?? capability).join(", "))
const scopeLabel = (config: Pick<AgentConfig, "scopeType">) => config.scopeType

/** Diferenças entre duas configurações completas (rascunho anterior → rascunho novo). */
function diffConfigs(before: AgentConfig, after: AgentConfig): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of ["name", "agentType", "objective", "description", "contextPrompt"] as const) {
    if (before[field] !== after[field]) changes.push({ field, label: FIELD_LABELS[field]!, from: String(before[field]), to: String(after[field]) })
  }
  if (before.scopeType !== after.scopeType || before.teamId !== after.teamId || before.subteamId !== after.subteamId) {
    changes.push({ field: "scopeType", label: FIELD_LABELS.scopeType!, from: scopeLabel(before), to: scopeLabel(after) })
  }
  const knowledgeChange = diffIdList("knowledgeDocumentIds", before.knowledgeDocumentIds, after.knowledgeDocumentIds)
  if (knowledgeChange) changes.push(knowledgeChange)
  const limitsBefore = describeActionLimits({ enabled: before.actionLimitsEnabled, text: before.actionLimits })
  const limitsAfter = describeActionLimits({ enabled: after.actionLimitsEnabled, text: after.actionLimits })
  if (limitsBefore !== limitsAfter) changes.push({ field: "actionLimits", label: FIELD_LABELS.actionLimits!, from: limitsBefore, to: limitsAfter })
  const capabilitiesBefore = normalizeCapabilities(before.investigationCapabilities)
  const capabilitiesAfter = normalizeCapabilities(after.investigationCapabilities)
  if (capabilitiesBefore.join(",") !== capabilitiesAfter.join(",")) changes.push({ field: "investigationCapabilities", label: FIELD_LABELS.investigationCapabilities!, from: capabilityLabel(capabilitiesBefore), to: capabilityLabel(capabilitiesAfter) })
  if (before.specialtyKind !== after.specialtyKind || before.businessDomainId !== after.businessDomainId || before.capability !== after.capability || before.consolidatedInput !== after.consolidatedInput) {
    changes.push({ field: "specialty", label: FIELD_LABELS.specialty!, from: before.specialty ?? before.specialtyKind ?? "—", to: after.specialty ?? after.specialtyKind ?? "—" })
  }
  if (before.recommendSupportMaterials !== after.recommendSupportMaterials) {
    changes.push({ field: "recommendSupportMaterials", label: FIELD_LABELS.recommendSupportMaterials!, from: before.recommendSupportMaterials ? "Sim" : "Não", to: after.recommendSupportMaterials ? "Sim" : "Não" })
  }
  return changes
}

type HistoryAction = "CREATED" | "UPDATED" | "DUPLICATED" | "PUBLISHED" | "REVERTED" | "DRAFT_DISCARDED"

/** `configs`: as configurações cujos valores a alteração mostra (antes e depois) — o alcance delas decide quem lê os valores. */
async function recordAgentHistory(client: Pick<Database, "query">, organizationId: string, input: { agentId: string; action: HistoryAction; actor: AgentActor; changes: FieldChange[]; configs?: AgentConfig[] }) {
  const configScopes = input.configs?.map((config) => ({ scopeType: config.scopeType, teamId: config.teamId, subteamId: config.subteamId }))
  const changes: StoredFieldChange[] = configScopes ? input.changes.map((change) => ({ ...change, configScopes })) : input.changes
  await client.query(
    `insert into agent_history(organization_id, agent_id, action, changed_by_person_id, changed_by_name, changes)
     values ($1,$2,$3,$4,$5,$6)`,
    [organizationId, input.agentId, input.action, input.actor.personId, input.actor.name, JSON.stringify(changes)],
  )
}

/** Segurança de KB por código, não por confiança no id enviado pelo frontend: só bases da
 * organização e não excluídas podem ser autorizadas para um agente. */
async function assertKnowledgeDocumentsExist(client: Pick<Database, "query">, organizationId: string, knowledgeDocumentIds: string[]) {
  const uniqueIds = [...new Set(knowledgeDocumentIds)]
  if (uniqueIds.length === 0) return
  const found = await client.query<{ id: string }>(
    `select id from knowledge_documents where id = any($1::uuid[]) and organization_id = $2 and deleted_at is null`,
    [uniqueIds, organizationId],
  )
  if (found.rows.length !== uniqueIds.length) {
    throw new DomainError("Uma das bases de conhecimento selecionadas não existe ou foi excluída.", "AGENT_KNOWLEDGE_NOT_FOUND", 422)
  }
}

/**
 * Base de outro Grupo não entra num Agent de Grupo (achado A-F07): o conteúdo dela iria parar nas respostas que o Agent dá
 * para gente de fora do Grupo da base. Agent de Grupo/Subgrupo aceita base global ou do MESMO Grupo; Agent "todos os
 * Grupos" (só quem administra a organização cria) aceita qualquer base da organização. Conferido contra o alcance da
 * CONFIGURAÇÃO (rascunho, ou versão a publicar) — não mais o da linha gravada.
 */
async function assertKnowledgeDocumentsCompatible(client: Pick<Database, "query">, organizationId: string, scope: Pick<AgentConfig, "scopeType" | "teamId" | "subteamId">, knowledgeDocumentIds: string[]) {
  const uniqueIds = [...new Set(knowledgeDocumentIds)]
  if (uniqueIds.length === 0 || scope.scopeType === "ALL_TEAMS") return
  const compatible = await client.query<{ id: string }>(
    `with agent as (select case when $3 = 'SUBTEAM' then (select st.team_id from subteams st where st.id = $5::uuid) else $4::uuid end team_id)
     select d.id from knowledge_documents d, agent
      where d.id = any($1::uuid[]) and d.organization_id = $2 and d.deleted_at is null
        and exists (
          select 1 from knowledge_document_org_scopes os left join subteams st on st.id = os.subteam_id
           where os.knowledge_document_id = d.id and (os.scope_type = 'ALL_TEAMS' or coalesce(os.team_id, st.team_id) = agent.team_id))`,
    [uniqueIds, organizationId, scope.scopeType, scope.teamId, scope.subteamId],
  )
  if (compatible.rows.length !== uniqueIds.length) {
    throw new DomainError("Uma das bases de conhecimento selecionadas vale para outro Grupo — escolha bases globais ou do Grupo deste agente.", "AGENT_KNOWLEDGE_SCOPE_FORBIDDEN", 422)
  }
}

async function assertKnowledge(client: Pick<Database, "query">, organizationId: string, config: AgentConfig) {
  await assertKnowledgeDocumentsExist(client, organizationId, config.knowledgeDocumentIds)
  await assertKnowledgeDocumentsCompatible(client, organizationId, config, config.knowledgeDocumentIds)
}

/** Outro agente da organização já usa o nome (a unicidade vale para a linha viva; conferida também no rascunho). */
async function assertNameAvailable(client: Pick<Database, "query">, organizationId: string, name: string, agentId: string | null) {
  const taken = await client.query(`select 1 from agents where organization_id = $1 and name = $2 and ($3::uuid is null or id <> $3::uuid)`, [organizationId, name, agentId])
  if (taken.rows[0]) throw new DomainError("Já existe um agente com esse nome.", "AGENT_NAME_TAKEN", 409)
}

const scopeForbidden = () => new DomainError("Você não tem permissão para mover o agente para esse escopo.", "AGENT_SCOPE_FORBIDDEN", 403)

/**
 * Rascunho e versões guardam o PRÓPRIO alcance, que pode ser maior que o da linha viva conferida por `authorizeAgent` (o agente
 * já foi "todos os Grupos" numa versão anterior, ou quem administra a organização preparou o rascunho). Quem age sobre uma
 * configuração — prévia das instruções, teste, prévia da publicação, publicar, reverter, salvar ou descartar o rascunho — precisa
 * alcançar também o alcance DELA, a mesma regra de mover o agente no PATCH. Sem isso, quem administra um Grupo montava o prompt
 * (com as bases) de uma versão de todos os Grupos, a testava ou a publicava de novo. Sem configuração (null) não há o que conferir.
 */
function authorizeAgentConfig(scopes: ManageableScopes, config: ScopedTarget | null | undefined): void {
  if (!canReadAgentConfig(scopes, config)) throw scopeForbidden()
}

/**
 * Regra de LEITURA do módulo (a de `authorizeAgent`: administrar agentes no alcance) aplicada ao alcance de uma configuração. Quem
 * lê o agente pelo alcance da linha viva não lê, só por isso, o rascunho, uma versão ou o conteúdo testado de outro alcance: o
 * contexto, as bases, as ferramentas e os limites deles saem só com id, número, situação, datas, autor e `restricted: true` (como
 * as Bases fazem com a versão restrita). Sem configuração (null) não há o que esconder.
 */
function canReadAgentConfig(scopes: ManageableScopes, config: ScopedTarget | null | undefined): boolean {
  return !config || canManageScope(scopes, config)
}

/** Alcance de uma configuração guardada em JSON (versão, conteúdo testado), sem o resto dela. */
const configScopeSql = (config: string) =>
  `case when ${config} is null then null else jsonb_build_object('scopeType', ${config}->>'scopeType', 'teamId', ${config}->>'teamId', 'subteamId', ${config}->>'subteamId') end`

/**
 * Alteração do histórico com o alcance das configurações envolvidas (antes e depois) — o histórico guarda os valores completos
 * (contexto, limites). Quem não alcança uma delas vê só quem alterou, quando e quais campos (`restricted`). Registro gravado antes
 * de 09/11/2026 não guarda o alcance: falha fechado — os valores de configuração dele só aparecem para quem alcança TODOS os
 * alcances que o agente já teve (`readsEveryAgentScope`). Situação, versão e rascunho não são configuração e saem sempre.
 */
type StoredFieldChange = FieldChange & { configScopes?: ScopedTarget[] }

const NON_CONFIG_HISTORY_FIELDS = new Set(["active", "version", "draft"])

function readableHistoryEntry(scopes: ManageableScopes, entry: { changes: StoredFieldChange[] }, readsLegacyValues: boolean) {
  const restricted = entry.changes.some((change) =>
    change.configScopes ? change.configScopes.some((scope) => !canReadAgentConfig(scopes, scope)) : !readsLegacyValues && !NON_CONFIG_HISTORY_FIELDS.has(change.field),
  )
  return {
    ...entry,
    changes: entry.changes.map((change) => ({ field: change.field, label: change.label, from: restricted ? "" : change.from, to: restricted ? "" : change.to })),
    restricted,
  }
}

/** Quem lê alcança todos os alcances que o agente já teve: o da linha viva, o do rascunho e o de cada versão publicada. */
async function readsEveryAgentScope(db: Pick<Database, "query">, organizationId: string, agentId: string, access: { scope: ScopedTarget; scopes: ManageableScopes }): Promise<boolean> {
  if (access.scopes.unrestricted || access.scopes.allTeams) return true
  const versions = await db.query<ScopedTarget>(
    `select distinct v.config->>'scopeType' "scopeType", v.config->>'teamId' "teamId", v.config->>'subteamId' "subteamId"
       from agent_versions v where v.agent_id = $1 and v.organization_id = $2`,
    [agentId, organizationId],
  )
  const draft = (await loadAgentLifecycle(db, organizationId, agentId))?.draftConfig ?? null
  return [access.scope, draft, ...versions.rows].every((scope) => canReadAgentConfig(access.scopes, scope))
}

type AgentRunRow = {
  id: string; source: string; inputContext: string | null; outputText: string | null; status: string; errorMessage: string | null; model: string | null; caseId: string | null
  createdAt: string; completedAt: string | null; agentVersionId: string | null; agentVersionNumber: number | null; runTarget: string | null; hasTestedConfig: boolean; configScope: ScopedTarget | null
}

/** Execução de uma configuração de outro alcance: só id, origem, situação, datas e versão — a entrada e a saída também ficam de fora. */
function readableRun(scopes: ManageableScopes, { configScope, ...run }: AgentRunRow) {
  if (canReadAgentConfig(scopes, configScope)) return { ...run, restricted: false }
  return { ...run, inputContext: null, outputText: null, errorMessage: null, model: null, caseId: null, hasTestedConfig: false, restricted: true }
}

/** Configuração seguinte = a editável + o que veio no pedido, validada como um cadastro inteiro (inclusive o alcance resultante). */
async function nextConfig(client: Pick<Database, "query">, organizationId: string, scopes: ManageableScopes, base: AgentConfig, input: z.infer<typeof updateAgentSchema>): Promise<AgentConfig> {
  let scope: ScopedTarget = { scopeType: base.scopeType, teamId: base.teamId, subteamId: base.subteamId }
  if (input.scopeType !== undefined) {
    const normalized = await normalizeScopedTarget(client, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null })
    if (!normalized) throw scopeForbidden()
    scope = normalized
  }
  authorizeAgentConfig(scopes, scope)
  const specialty = await specialtyFromInput(client, organizationId, input, await specialtyOfConfig(client, base))
  const actionLimits: AgentActionLimits = {
    enabled: input.actionLimitsEnabled ?? base.actionLimitsEnabled,
    text: input.actionLimits !== undefined ? actionLimitsText(input.actionLimits) : base.actionLimits,
  }
  assertActionLimits(actionLimits)
  const config: AgentConfig = {
    ...base,
    name: input.name ?? base.name,
    agentType: input.agentType ?? base.agentType,
    objective: input.objective ?? base.objective,
    description: input.description ?? base.description,
    contextPrompt: input.contextPrompt ?? base.contextPrompt,
    scopeType: scope.scopeType as AgentConfig["scopeType"],
    teamId: scope.teamId,
    subteamId: scope.subteamId,
    ...(specialty
      ? { specialty: legacySpecialtyFor(specialty), specialtyKind: specialty.kind, domain: specialty.domain?.code ?? null, capability: specialty.capability, consolidatedInput: specialty.acceptsConsolidated, businessDomainId: specialty.domain?.id ?? null }
      : {}),
    recommendSupportMaterials: input.recommendSupportMaterials ?? base.recommendSupportMaterials,
    investigationCapabilities: input.investigationCapabilities ? normalizeCapabilities(input.investigationCapabilities) : base.investigationCapabilities,
    actionLimitsEnabled: actionLimits.enabled,
    actionLimits: actionLimits.text,
    knowledgeDocumentIds: input.knowledgeDocumentIds ? [...new Set(input.knowledgeDocumentIds)].sort() : base.knowledgeDocumentIds,
  }
  await assertKnowledge(client, organizationId, config)
  return config
}

const notFound = () => new DomainError("Agente não encontrado.", "AGENT_NOT_FOUND", 404)
const inactiveRestricted = () =>
  new DomainError("Este agente está inativo. Só administradores consultam o cadastro, o histórico completo e as execuções de agentes inativos, e podem reativá-los ou excluí-los.", "AGENT_INACTIVE_RESTRICTED", 403)

type AgentAccess = { scope: ScopedTarget; active: boolean; scopes: ManageableScopes; canManageInactive: boolean }

/**
 * Autorização de toda rota de um agente: fora do alcance de quem administra agentes = "não encontrado" (RN-051); agente inativo
 * só com `agents.inactive.manage` no alcance dele (PEN-001, PEN-068). `forUpdate` não trava aqui — as escritas travam a linha.
 */
async function authorizeAgent(db: Database, request: Request, agentId: string): Promise<AgentAccess> {
  const user = sessionUser(request)
  const row = (await db.query<{ scopeType: string; teamId: string | null; subteamId: string | null; active: boolean }>(
    `select scope_type "scopeType", team_id "teamId", subteam_id "subteamId", active from agents where id = $1 and organization_id = $2`,
    [agentId, user.organizationId],
  )).rows[0]
  if (!row) throw notFound()
  const scopes = await getManageableScopes(db, user, "agents.manage")
  const scope = { scopeType: row.scopeType, teamId: row.teamId, subteamId: row.subteamId }
  if (!canManageScope(scopes, scope)) throw notFound()
  const canManageInactive = canManageScope(await getManageableScopes(db, user, "agents.inactive.manage"), scope)
  if (!row.active && !canManageInactive) throw inactiveRestricted()
  return { scope, active: row.active, scopes, canManageInactive }
}

function actorOf(request: Request): AgentActor {
  return { personId: request.user?.personId ?? null, name: request.user?.name ?? "Sistema" }
}

async function lifecycleForWrite(client: Pick<Database, "query">, organizationId: string, agentId: string): Promise<AgentLifecycleRow> {
  const lifecycle = await loadAgentLifecycle(client, organizationId, agentId, { forUpdate: true })
  if (!lifecycle) throw notFound()
  return lifecycle
}

function rethrowNameTaken(error: unknown): never {
  if ((error as { code?: string }).code === "23505") throw new DomainError("Já existe um agente com esse nome.", "AGENT_NAME_TAKEN", 409)
  throw error
}

export function createAgentRouter(db: Database) {
  const router = Router()

  /** O agente (linha viva = versão vigente) e o rascunho — este sem a configuração quando é de um alcance que `scopes` não alcança. */
  const respondAgent = async (organizationId: string, agentId: string, scopes: ManageableScopes) => {
    const row = (await db.query(`${AGENT_SELECT} and a.id = $2`, [organizationId, agentId])).rows[0]
    const lifecycle = await loadAgentLifecycle(db, organizationId, agentId)
    const draftConfig = lifecycle?.draftConfig ?? null
    const restricted = !canReadAgentConfig(scopes, draftConfig)
    return {
      ...row,
      draft: lifecycle && draftConfig
        ? { config: restricted ? null : draftConfig, revision: lifecycle.draftRevision, updatedAt: lifecycle.draftUpdatedAt, updatedByName: lifecycle.draftUpdatedByName, restricted }
        : null,
    }
  }

  router.get("/", async (request, response) => {
    const user = sessionUser(request)
    const input = listAgentsSchema.parse(request.query)
    const scopes = await getManageableScopes(db, user, "agents.manage")
    const inactiveScopes = await getManageableScopes(db, user, "agents.inactive.manage")
    const filter = new SqlFilter([user.organizationId])
      .search(input.search, ["q.name", "q.objective", "q.description"])
      .in('q."agentType"', input.agentType)
      .equals("q.active", input.active)
      .orgScope("q", input)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    if (input.knowledgeDocumentId) {
      filter.add(`exists (select 1 from agent_knowledge_documents akd where akd.agent_id = q.id and akd.knowledge_document_id = ${filter.param(input.knowledgeDocumentId)}::uuid)`)
    }
    applyManageableScopeFilter(scopes, filter)
    // Inativos só aparecem para quem os administra, e só no alcance em que administra (PEN-001; servidor, não só a tela).
    if (!(inactiveScopes.unrestricted || inactiveScopes.allTeams)) {
      const teamIds = filter.param(inactiveScopes.unrestricted ? [] : [...inactiveScopes.teamIds])
      const subteamIds = filter.param(inactiveScopes.unrestricted ? [] : [...inactiveScopes.subteamIds])
      filter.add(`(q.active or (q."scopeType" = 'TEAM' and q."teamId" = any(${teamIds}::uuid[])) or (q."scopeType" = 'SUBTEAM' and q."subteamId" = any(${subteamIds}::uuid[])))`)
    }
    const data = await respondList(db, request.query, { select: AGENT_SELECT, filter, orderBy: 'q."usageCount" desc, q."createdAt" desc, q.id' })
    response.json({ data })
  })

  /**
   * Referências mínimas (nome, status, publicação e números de versão) de agentes citados por Workflows e orquestradores — inclusive
   * inativos, para o editor sinalizá-los (CA-009.12) sem abrir o cadastro deles a quem não é administrador (PEN-068).
   */
  router.get("/references", async (request, response) => {
    const user = sessionUser(request)
    const ids = (referencesSchema.parse(request.query).ids ?? "").split(",").map((id) => id.trim()).filter((id) => z.string().uuid().safeParse(id).success).slice(0, 200)
    if (ids.length === 0) return response.json({ data: [] })
    const scopes = await getManageableScopes(db, user, "agents.manage")
    const rows = (await db.query<{ id: string; name: string; agentType: string; active: boolean; published: boolean; currentVersionId: string | null; currentVersionNumber: number | null; scopeType: string; teamId: string | null; subteamId: string | null; versions: { id: string; number: number; publishedAt: string }[] }>(
      `select a.id, a.name, a.agent_type "agentType", a.active, (a.current_version_id is not null) "published", a.current_version_id "currentVersionId", cv.version_number "currentVersionNumber",
              a.scope_type "scopeType", a.team_id "teamId", a.subteam_id "subteamId",
              coalesce((select json_agg(json_build_object('id', v.id, 'number', v.version_number, 'publishedAt', v.published_at) order by v.version_number desc) from agent_versions v where v.agent_id = a.id), '[]') "versions"
         from agents a left join agent_versions cv on cv.id = a.current_version_id
        where a.organization_id = $1 and a.id = any($2::uuid[])`,
      [user.organizationId, ids],
    )).rows
    response.json({ data: rows.filter((row) => canManageScope(scopes, row)).map((row) => ({ id: row.id, name: row.name, agentType: row.agentType, active: row.active, published: row.published, currentVersionId: row.currentVersionId, currentVersionNumber: row.currentVersionNumber, versions: row.versions })) })
  })

  router.get("/:id", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    response.json({ data: await respondAgent(sessionUser(request).organizationId, request.params.id!, access.scopes) })
  })

  /**
   * Histórico de alterações com os valores completos — de inativo, só administradores (PEN-072; `authorizeAgent`). Os valores de
   * uma alteração feita numa configuração de outro alcance ficam de fora (`readableHistoryEntry`).
   */
  router.get("/:id/history", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const result = await db.query<{ id: string; action: string; changedByName: string; changes: StoredFieldChange[]; createdAt: string }>(
      `select id, action, changed_by_name "changedByName", changes, created_at "createdAt"
       from agent_history
       where agent_id = $1 and organization_id = $2
       order by created_at desc`,
      [request.params.id, sessionUser(request).organizationId],
    )
    // Só consulta os alcances do agente quando há registro antigo (sem `configScopes`) com valor de configuração.
    const hasLegacyValues = result.rows.some((entry) => entry.changes.some((change) => !change.configScopes && !NON_CONFIG_HISTORY_FIELDS.has(change.field)))
    const readsLegacyValues = hasLegacyValues && (await readsEveryAgentScope(db, sessionUser(request).organizationId, request.params.id!, access))
    response.json({ data: result.rows.map((entry) => readableHistoryEntry(access.scopes, entry, readsLegacyValues)) })
  })

  /**
   * Execuções com a versão usada (PEN-002): número da versão, ou "Rascunho" no teste do rascunho. A de uma configuração (versão ou
   * rascunho testado) de outro alcance sai sem entrada, saída e conteúdo testado (`readableRun`).
   */
  router.get("/:id/runs", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const result = await db.query<AgentRunRow>(
      `select r.id, r.source, r.input_context "inputContext", r.output_text "outputText", r.status, r.error_message "errorMessage",
              r.model, r.case_id "caseId", r.created_at "createdAt", r.completed_at "completedAt",
              r.agent_version_id "agentVersionId", v.version_number "agentVersionNumber", r.run_target "runTarget", (r.tested_config is not null) "hasTestedConfig",
              ${configScopeSql("coalesce(r.tested_config, v.config)")} "configScope"
       from agent_runs r left join agent_versions v on v.id = r.agent_version_id
       where r.agent_id = $1 and r.organization_id = $2
       order by r.created_at desc
       limit 50`,
      [request.params.id, sessionUser(request).organizationId],
    )
    response.json({ data: result.rows.map((row) => readableRun(access.scopes, row)) })
  })

  /** Uma execução com o conteúdo efetivamente testado (PEN-049: o teste do rascunho guarda o que foi testado) — se for do alcance de quem lê. */
  router.get("/:id/runs/:runId", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const row = (await db.query<{ testedConfig: (ScopedTarget & Record<string, unknown>) | null } & Record<string, unknown>>(
      `select r.id, r.source, r.status, r.created_at "createdAt", r.completed_at "completedAt", r.run_target "runTarget",
              r.agent_version_id "agentVersionId", v.version_number "agentVersionNumber", coalesce(r.tested_config, v.config) "testedConfig"
       from agent_runs r left join agent_versions v on v.id = r.agent_version_id
       where r.id = $1 and r.agent_id = $2 and r.organization_id = $3`,
      [request.params.runId, request.params.id, sessionUser(request).organizationId],
    )).rows[0]
    if (!row) throw new DomainError("Execução não encontrada.", "AGENT_RUN_NOT_FOUND", 404)
    const restricted = !canReadAgentConfig(access.scopes, row.testedConfig)
    response.json({ data: { ...row, testedConfig: restricted ? null : row.testedConfig, restricted } })
  })

  /** Versões publicadas; `restricted` = a configuração dela é de um alcance que quem lê não alcança (não abre, não testa, não reverte). */
  router.get("/:id/versions", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const versions = await listAgentVersions(db, sessionUser(request).organizationId, request.params.id!)
    response.json({ data: versions.map(({ scope, ...version }) => ({ ...version, restricted: !canReadAgentConfig(access.scopes, scope) })) })
  })

  router.get("/:id/versions/:versionId", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const version = await loadAgentVersion(db, sessionUser(request).organizationId, request.params.id!, request.params.versionId!)
    if (!version) throw new DomainError("Versão não encontrada.", "AGENT_VERSION_NOT_FOUND", 404)
    const restricted = !canReadAgentConfig(access.scopes, version.config)
    response.json({ data: { ...version.summary, config: restricted ? null : version.config, restricted } })
  })

  /** Prévia das instruções: do rascunho salvo (padrão) ou de uma versão publicada. */
  router.get("/:id/preview-prompt", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const organizationId = sessionUser(request).organizationId
    const query = z.object({ versionId: z.string().uuid().optional() }).parse(request.query)
    const snapshot = query.versionId
      ? await (async () => {
          const version = await loadAgentVersion(db, organizationId, request.params.id!, query.versionId!)
          if (!version) throw new DomainError("Versão não encontrada.", "AGENT_VERSION_NOT_FOUND", 404)
          return { agentId: request.params.id!, organizationId, versionId: version.summary.id, versionNumber: version.summary.number, config: version.config }
        })()
      : await resolveAgentDraftForTest(db, organizationId, request.params.id!)
    authorizeAgentConfig(access.scopes, snapshot.config)
    const prompt = await withAgentSnapshots([snapshot], () =>
      buildSystemPrompt(db, request.params.id!, { organization_id: organizationId, name: snapshot.config.name, objective: snapshot.config.objective, description: snapshot.config.description, context_prompt: snapshot.config.contextPrompt }),
    )
    response.json({ data: { prompt } })
  })

  /**
   * Teste manual (PEN-049, decidida em 03/11/2026): do rascunho SALVO ou de uma versão publicada escolhida — alterações não salvas
   * nunca entram. O registro guarda a versão (ou o conteúdo do rascunho testado) e conta como uso (PEN-065, PEN-069). Testar uma
   * versão antiga não muda a vigente.
   */
  router.post("/:id/test", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const organizationId = sessionUser(request).organizationId
    const input = testAgentSchema.parse(request.body)
    const lifecycle = await loadAgentLifecycle(db, organizationId, request.params.id!)
    if (!lifecycle) throw notFound()
    const target = input.target ?? (input.versionId || lifecycle.currentVersionId ? "VERSION" : "DRAFT")
    if (target === "VERSION" && !input.versionId && !lifecycle.currentVersionId) {
      throw new DomainError("Este agente ainda não tem versão publicada: teste o rascunho.", "AGENT_NOT_PUBLISHED", 422)
    }
    const versionId = input.versionId ?? lifecycle.currentVersionId
    // O rascunho conferido é o que executa: a execução recebe esta leitura e não relê o rascunho (outra pessoa pode tê-lo salvo
    // com outro alcance no meio). Versão publicada não muda; inexistente segue para a execução, que responde AGENT_VERSION_NOT_FOUND.
    const draft = target === "DRAFT" ? (await resolveAgentDraftForTest(db, organizationId, request.params.id!)).config : null
    authorizeAgentConfig(access.scopes, draft ?? (versionId ? (await loadAgentVersion(db, organizationId, request.params.id!, versionId))?.config : null))
    const run = await runAgent(db, {
      organizationId,
      agentId: request.params.id!,
      inputContext: input.input,
      source: "MANUAL_TEST",
      target: draft ? { kind: "DRAFT", config: draft } : { kind: "VERSION", versionId },
    })
    response.status(201).json({ data: run })
  })

  /** Criar = rascunho (PEN-002): o agente só executa fora do teste depois da primeira publicação. */
  router.post("/", async (request, response) => {
    const user = sessionUser(request)
    const organizationId = user.organizationId
    const input = agentSchema.parse(request.body)

    const scopes = await getManageableScopes(db, user, "agents.manage")
    const scope = await normalizeScopedTarget(db, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null })
    if (!scope || !canManageScope(scopes, scope)) {
      throw new DomainError("Você não tem permissão para criar agentes nesse escopo.", "AGENT_SCOPE_FORBIDDEN", 403)
    }

    const specialty = (await specialtyFromInput(db, organizationId, input)) ?? { kind: null, domain: null, capability: null, acceptsConsolidated: false }
    const actionLimits: AgentActionLimits = { enabled: input.actionLimitsEnabled, text: actionLimitsText(input.actionLimits) }
    assertActionLimits(actionLimits)
    const config: AgentConfig = {
      name: input.name,
      agentType: input.agentType,
      objective: input.objective,
      description: input.description,
      contextPrompt: input.contextPrompt,
      scopeType: scope.scopeType as AgentConfig["scopeType"],
      teamId: scope.teamId,
      subteamId: scope.subteamId,
      specialty: legacySpecialtyFor(specialty),
      specialtyKind: specialty.kind,
      domain: specialty.domain?.code ?? null,
      capability: specialty.capability,
      consolidatedInput: specialty.acceptsConsolidated,
      businessDomainId: specialty.domain?.id ?? null,
      recommendSupportMaterials: input.recommendSupportMaterials ?? false,
      investigationCapabilities: normalizeCapabilities(input.investigationCapabilities),
      actionLimitsEnabled: actionLimits.enabled,
      actionLimits: actionLimits.text,
      knowledgeDocumentIds: [...new Set(input.knowledgeDocumentIds)].sort(),
    }
    await assertKnowledge(db, organizationId, config)
    const agentId = await inTransaction(db, async (client) => {
      const created = await client.query<{ id: string }>(
        `insert into agents(organization_id, name, agent_type, objective, description, context_prompt, scope_type, team_id, subteam_id, created_by, draft_config, draft_revision, draft_updated_at, draft_updated_by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,now(),$12) returning id`,
        [organizationId, config.name, config.agentType, config.objective, config.description, config.contextPrompt, config.scopeType, config.teamId, config.subteamId, request.user?.sub ?? null, JSON.stringify(config), actorOf(request).name],
      )
      const id = created.rows[0]!.id
      // Agente nunca publicado: a linha viva acompanha o rascunho (lista, busca), mas nada o executa fora do teste.
      await writeLiveAgentConfig(client, organizationId, id, config)
      await recordAgentHistory(client, organizationId, { agentId: id, action: "CREATED", actor: actorOf(request), changes: [] })
      return id
    }).catch(rethrowNameTaken)
    response.status(201).json({ data: await respondAgent(organizationId, agentId, scopes) })
  })

  /**
   * Editar = salvar o RASCUNHO (PEN-002, item 1): a versão em uso não muda até publicar. Com `expectedDraftRevision` diferente
   * da atual, nada é gravado (PEN-050). `active` liga/desliga na hora (controle separado da publicação; reativar = administrador).
   */
  router.patch("/:id", async (request, response) => {
    const user = sessionUser(request)
    const organizationId = user.organizationId
    const agentId = request.params.id!
    const access = await authorizeAgent(db, request, agentId)
    const { active, expectedDraftRevision, ...changes } = updateAgentSchema.parse(request.body)
    const touchesConfig = Object.values(changes).some((value) => value !== undefined)
    if (active === true && !access.active && !access.canManageInactive) throw inactiveRestricted()
    await inTransaction(db, async (client) => {
      const lifecycle = await lifecycleForWrite(client, organizationId, agentId)
      if (touchesConfig) {
        assertDraftRevision(lifecycle, expectedDraftRevision)
        const base = lifecycle.draftConfig ?? (await loadLiveAgentConfig(client, organizationId, agentId))
        if (!base) throw notFound()
        // Sobrescrever o rascunho é agir sobre ele (como descartá-lo); `nextConfig` confere o alcance resultante.
        authorizeAgentConfig(access.scopes, base)
        const config = await nextConfig(client, organizationId, access.scopes, base, changes)
        await assertNameAvailable(client, organizationId, config.name, agentId)
        await saveAgentDraft(client, lifecycle, config, actorOf(request))
        // Nunca publicado: não há versão em uso a proteger — a linha viva acompanha o rascunho.
        if (!lifecycle.currentVersionId) await writeLiveAgentConfig(client, organizationId, agentId, config)
        const diff = diffConfigs(base, config)
        if (diff.length > 0) await recordAgentHistory(client, organizationId, { agentId, action: "UPDATED", actor: actorOf(request), changes: diff, configs: [base, config] })
      }
      if (active !== undefined && active !== lifecycle.active) {
        await client.query(`update agents set active = $3, updated_at = now() where id = $1 and organization_id = $2`, [agentId, organizationId, active])
        await recordAgentHistory(client, organizationId, { agentId, action: "UPDATED", actor: actorOf(request), changes: [{ field: "active", label: FIELD_LABELS.active!, from: lifecycle.active ? "Ativo" : "Inativo", to: active ? "Ativo" : "Inativo" }] })
      }
    }).catch(rethrowNameTaken)
    response.json({ data: await respondAgent(organizationId, agentId, access.scopes) })
  })

  /**
   * Prévia da publicação (revisão de 03/11/2026): consumidores afetados que a pessoa pode consultar, aviso dos restritos, mudanças
   * em bases, ferramentas, alcance e limites, e quem deixaria de ser atendido pelo alcance novo.
   */
  router.get("/:id/publish-impact", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const { versionId } = publishImpactQuerySchema.parse(request.query)
    const impact = await computePublishImpact(db, sessionUser(request), request.params.id!, { revertToVersionId: versionId, authorizeTarget: (config) => authorizeAgentConfig(access.scopes, config) })
    if (!impact) throw new DomainError("Versão não encontrada.", "AGENT_VERSION_NOT_FOUND", 404)
    response.json({ data: impact })
  })

  /**
   * Publicar (PEN-002 itens 2 e 8; revisão de 03/11/2026): versão nova, imutável e VIGENTE — vale nas próximas execuções de todos
   * os consumidores (chat, voz, Workflows, orquestradores), sem republicá-los. Não mexe em `active` e não concede permissão a
   * ninguém: cada execução confere de novo a autorização no contexto dela (agent-execution-authorization.ts).
   */
  router.post("/:id/publish", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const agentId = request.params.id!
    const access = await authorizeAgent(db, request, agentId)
    const { expectedDraftRevision } = revisionSchema.parse(request.body ?? {})
    const version = await inTransaction(db, async (client) => {
      const lifecycle = await lifecycleForWrite(client, organizationId, agentId)
      assertDraftRevision(lifecycle, expectedDraftRevision)
      authorizeAgentConfig(access.scopes, lifecycle.draftConfig)
      if (lifecycle.draftConfig) {
        await assertKnowledge(client, organizationId, lifecycle.draftConfig)
        await assertNameAvailable(client, organizationId, lifecycle.draftConfig.name, agentId)
      }
      const published = await publishAgentDraft(client, lifecycle, actorOf(request))
      await recordAgentHistory(client, organizationId, { agentId, action: "PUBLISHED", actor: actorOf(request), changes: [{ field: "version", label: FIELD_LABELS.version!, from: lifecycle.currentVersionNumber ? `Versão ${lifecycle.currentVersionNumber}` : "Não publicado", to: `Versão ${published.number}` }] })
      return published
    }).catch(rethrowNameTaken)
    response.status(201).json({ data: { version, agent: await respondAgent(organizationId, agentId, access.scopes) } })
  })

  /** Descartar o rascunho: volta a editar a versão vigente (agente nunca publicado não tem para onde voltar). */
  router.post("/:id/draft/discard", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const agentId = request.params.id!
    const access = await authorizeAgent(db, request, agentId)
    const { expectedDraftRevision } = revisionSchema.parse(request.body ?? {})
    await inTransaction(db, async (client) => {
      const lifecycle = await lifecycleForWrite(client, organizationId, agentId)
      assertDraftRevision(lifecycle, expectedDraftRevision)
      authorizeAgentConfig(access.scopes, lifecycle.draftConfig)
      if (!lifecycle.draftConfig) return
      await discardAgentDraft(client, lifecycle, actorOf(request))
      await recordAgentHistory(client, organizationId, { agentId, action: "DRAFT_DISCARDED", actor: actorOf(request), changes: [{ field: "draft", label: FIELD_LABELS.draft!, from: "Alterações não publicadas", to: `Descartadas (volta à versão ${lifecycle.currentVersionNumber})` }] })
    })
    response.json({ data: await respondAgent(organizationId, agentId, access.scopes) })
  })

  /** Reverter (PEN-002 item 7, PEN-050): a configuração da versão escolhida vira versão NOVA; rascunho em andamento só com confirmação. */
  router.post("/:id/versions/:versionId/revert", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const agentId = request.params.id!
    const access = await authorizeAgent(db, request, agentId)
    const { discardDraft, expectedDraftRevision } = revertSchema.parse(request.body ?? {})
    const outcome = await inTransaction(db, async (client) => {
      const lifecycle = await lifecycleForWrite(client, organizationId, agentId)
      assertDraftRevision(lifecycle, expectedDraftRevision)
      const source = await loadAgentVersion(client, organizationId, agentId, request.params.versionId!)
      if (!source) throw new DomainError("Versão não encontrada.", "AGENT_VERSION_NOT_FOUND", 404)
      // A versão que volta a valer e o rascunho que a reversão descarta.
      authorizeAgentConfig(access.scopes, source.config)
      authorizeAgentConfig(access.scopes, lifecycle.draftConfig)
      await assertKnowledge(client, organizationId, source.config)
      await assertNameAvailable(client, organizationId, source.config.name, agentId)
      const reverted = await revertAgentToVersion(client, lifecycle, { id: source.summary.id, config: source.config }, actorOf(request), { discardDraft })
      await recordAgentHistory(client, organizationId, { agentId, action: "REVERTED", actor: actorOf(request), changes: [
        { field: "version", label: FIELD_LABELS.version!, from: lifecycle.currentVersionNumber ? `Versão ${lifecycle.currentVersionNumber}` : "Não publicado", to: `Versão ${reverted.number} (configuração da versão ${source.summary.number})` },
        ...(reverted.discardedDraft ? [{ field: "draft", label: FIELD_LABELS.draft!, from: "Alterações não publicadas", to: "Descartadas na reversão" }] : []),
      ] })
      return reverted
    }).catch(rethrowNameTaken)
    response.status(201).json({ data: { version: { id: outcome.id, number: outcome.number }, agent: await respondAgent(organizationId, agentId, access.scopes) } })
  })

  /** Pode excluir? Uso, dependências visíveis e o aviso de dependências sem permissão de consulta (PEN-065, PEN-066). */
  router.get("/:id/deletion-check", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const assessment = await assessAgentDeletion(db, sessionUser(request), request.params.id!)
    response.json({ data: { ...assessment, active: access.active, canDeactivate: access.active } })
  })

  /** Exclusão definitiva só sem uso nem dependências, conferida com a linha travada (PEN-069). Bases nunca são apagadas. */
  router.delete("/:id", async (request, response) => {
    const agentId = request.params.id!
    await authorizeAgent(db, request, agentId)
    await inTransaction(db, (client) => deleteAgentIfUnused(db, client, sessionUser(request), agentId))
    response.status(204).send()
  })

  return router
}
