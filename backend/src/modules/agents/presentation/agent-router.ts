import { Router, type Request } from "express"
import { OPERATING_UNIVERSES, optionalOperatingUniverseSchema } from "../../operating-universe/domain/operating-universe.js"
import { assertUniverseRequiredFor } from "../../operating-universe/application/universe-access.js"
import { z } from "zod"
import { investigationCapabilitySchema, normalizeCapabilities } from "../../investigation/domain/capabilities.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { booleanParam, dateParam, listParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { canManageScope, getManageableScopes, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { loadResourceScope, loadResourceScopeLinks, scopedTargetOf } from "../../org-structure/application/resource-scope-links.js"
import { resourceScopeLinksJsonSql, resourceScopeOf, type ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import { resourceScopeFields, resourceScopeTypeSchema } from "../../../shared/presentation/scope-links-schema.js"
import { agentBusinessDomainJoin, agentBusinessDomainJson } from "../../business-domains/application/business-domain-lookup.js"
import { businessDomainCodeSchema } from "../../business-domains/domain/business-domain.js"
import { agentTextSchema } from "../domain/agent-field-limits.js"
import type { AgentActionLimits } from "../domain/action-limits.js"
import { legacySpecialtySchema, specialtyKindSchema } from "../domain/agent-specialty.js"
import { agentScopeFields, agentScopeOf, type AgentConfig } from "../domain/agent-config.js"
import { runAgent } from "../application/run-agent.js"
import { buildSystemPrompt } from "../application/build-system-prompt.js"
import { withAgentSnapshots } from "../application/agent-runtime-context.js"
import { assertDraftRevision, discardAgentDraft, listAgentVersions, loadAgentLifecycle, loadAgentVersion, loadLiveAgentConfig, resolveAgentDraftForTest, revertAgentToVersion, writeLiveAgentConfig, type AgentActor } from "../application/agent-versions.js"
import { assessAgentDeletion, deleteAgentIfUnused } from "../application/agent-deletion.js"
import { computePublishImpact } from "../application/agent-publish-impact.js"
import { loadKnowledgeLinkCandidates, loadKnowledgeLinkContext, pageKnowledgeLinkCandidates } from "../application/agent-knowledge-links.js"
import { applyKnowledgeLinks, MAX_KNOWLEDGE_LINK_CHANGES, previewKnowledgeLinks } from "../application/agent-knowledge-link-changes.js"
import { actionLimitsText, agentNotFound, assertActionLimits, assertKnowledge, assertNameAvailable, authorizeAgentConfig, canReadAgentConfig, lifecycleForWrite, manageableAgentScopeSql, nextConfig, previousAgentScope, resolveAgentScopeForWrite, rethrowNameTaken, specialtyFields, specialtyFromInput, type AgentScopeLike } from "../application/agent-config-rules.js"
import { fieldChange, NON_CONFIG_HISTORY_FIELDS, readableHistoryEntry, recordAgentHistory, versionLabel, type StoredFieldChange } from "../application/agent-history.js"
import { configScopeSql, readableRun, readsEveryAgentScope, type AgentRunRow } from "../application/agent-read-access.js"
import { publishCheckedDraft, saveDraftWithHistory } from "../application/agent-draft-writes.js"
import { applyUniverseListFilter, universeListParam } from "../../operating-universe/application/universe-list-filter.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Cadastro de agentes. Ciclo de vida decidido em 03/11/2026 (ESP-INIA-03 §4.1):
 * - PEN-002 / PEN-050: alterações vão para um RASCUNHO (revisão otimista contra sobrescrita silenciosa); publicar cria versão
 *   imutável e vigente; reverter publica de novo uma versão anterior como versão nova; publicar não reativa.
 * - PEN-001 / PEN-068: agente INATIVO — listar, consultar o cadastro, ver o histórico completo, reativar e excluir só com
 *   `agents.inactive.manage` (administradores; o mapeamento dos perfis do cliente é a PEN-032), conferido aqui no servidor.
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
  /** Universo de atuação do agente (B2B/B2C/B2X) — classificação direta, não versionada; obrigatório com a exigência ativa. */
  operatingUniverse: optionalOperatingUniverseSchema,
  name: agentTextSchema("name"),
  agentType: z.enum(AGENT_TYPES),
  objective: agentTextSchema("objective"),
  description: agentTextSchema("description"),
  contextPrompt: agentTextSchema("contextPrompt"),
  /** Alcance (249): ALL_TEAMS ou GROUPS + `scopeLinks` (Grupo inteiro ou Subgrupo); o legado TEAM/SUBTEAM + ids vira um vínculo. */
  ...resourceScopeFields,
  scopeType: resourceScopeTypeSchema.default("ALL_TEAMS"),
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
  ...resourceScopeFields,
  scopeType: resourceScopeTypeSchema.optional(),
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

const listAgentsSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  agentType: listParam(z.enum(AGENT_TYPES)),
  active: booleanParam,
  knowledgeDocumentId: z.string().uuid().optional(),
  createdFrom: dateParam,
  createdTo: dateParam,
  operatingUniverse: universeListParam,
})

const AGENT_SELECT = `
  select
    a.id, a.name, a.agent_type "agentType", a.objective, a.description, a.context_prompt "contextPrompt",
    a.active, a.created_at "createdAt", a.specialty, a.operating_universe "operatingUniverse",
    a.specialty_kind "specialtyKind", a.domain, a.capability, a.consolidated_input "consolidatedInput",
    a.business_domain_id "businessDomainId", ${agentBusinessDomainJson("bd")} "businessDomain",
    a.recommend_support_materials "recommendSupportMaterials",
    coalesce(a.investigation_capabilities, '{}'::text[]) "investigationCapabilities",
    a.action_limits_enabled "actionLimitsEnabled", a.action_limits "actionLimits",
    a.scope_type "scopeType", ${resourceScopeLinksJsonSql("AGENT", "a.id")} "scopeLinks",
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
  left join user_accounts ua on ua.id = a.created_by
  left join people cp on cp.id = ua.person_id
  where a.organization_id = $1
`

const inactiveRestricted = () =>
  new DomainError("Este agente está inativo. Só administradores consultam o cadastro, o histórico completo e as execuções de agentes inativos, e podem reativá-los ou excluí-los.", "AGENT_INACTIVE_RESTRICTED", 403)

const knowledgeLinksQuerySchema = z.object({
  knowledgeDocumentId: z.string().uuid(),
  tab: z.enum(["LINKED", "AVAILABLE"]).default("LINKED"),
  search: z.string().trim().max(200).optional(),
  agentType: z.enum(AGENT_TYPES).optional(),
  universe: z.enum([...OPERATING_UNIVERSES, "PENDING"]).optional(),
  scopeType: z.literal("ALL_TEAMS").optional(),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  state: z.enum(["PUBLISHED", "NOT_PUBLISHED", "DRAFT_PENDING", "INACTIVE"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
const knowledgeLinksSchema = z.object({
  knowledgeDocumentId: z.string().uuid(),
  /** DRAFT = grava no rascunho de cada agente; PUBLISH = grava e publica (quem tem outras alterações pendentes fica só no rascunho). */
  mode: z.enum(["DRAFT", "PUBLISH"]),
  changes: z.array(z.object({
    agentId: z.string().uuid(),
    linked: z.boolean(),
    /** PEN-050: a revisão do rascunho que a pessoa viu na lista. Diferente da atual = 409, nada é gravado em nenhum agente. */
    expectedDraftRevision: z.number().int().nonnegative(),
  })).min(1).max(MAX_KNOWLEDGE_LINK_CHANGES).refine((changes) => new Set(changes.map((change) => change.agentId)).size === changes.length, { message: "Cada agente só pode aparecer uma vez." }),
})

type AgentAccess = { scope: ResourceScope; active: boolean; scopes: ManageableScopes; canManageInactive: boolean; operatingUniverse: string | null }

/**
 * Autorização de toda rota de um agente: fora do alcance de quem administra agentes = "não encontrado" (RN-051); agente inativo
 * só com `agents.inactive.manage` no alcance dele (PEN-001, PEN-068). `forUpdate` não trava aqui — as escritas travam a linha.
 */
async function authorizeAgent(db: Database, request: Request, agentId: string): Promise<AgentAccess> {
  const user = sessionUser(request)
  const row = (await db.query<{ scopeType: string; active: boolean; operatingUniverse: string | null }>(
    `select scope_type "scopeType", active, operating_universe "operatingUniverse" from agents where id = $1 and organization_id = $2`,
    [agentId, user.organizationId],
  )).rows[0]
  if (!row) throw agentNotFound()
  const scopes = await getManageableScopes(db, user, "agents.manage")
  // Vários vínculos (249): administrar o agente exige TODOS no alcance de quem pede (`canManageScope` com GROUPS).
  const scope = await loadResourceScope(db, "AGENT", agentId, row.scopeType)
  if (!canManageScope(scopes, scopedTargetOf(scope))) throw agentNotFound()
  const canManageInactive = canManageScope(await getManageableScopes(db, user, "agents.inactive.manage"), scopedTargetOf(scope))
  if (!row.active && !canManageInactive) throw inactiveRestricted()
  return { scope, active: row.active, scopes, canManageInactive, operatingUniverse: row.operatingUniverse }
}

function actorOf(request: Request): AgentActor {
  return { personId: request.user?.personId ?? null, name: request.user?.name ?? "Sistema" }
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
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    applyUniverseListFilter(filter, 'q."operatingUniverse"', input.operatingUniverse)
    if (input.knowledgeDocumentId) {
      filter.add(`exists (select 1 from agent_knowledge_documents akd where akd.agent_id = q.id and akd.knowledge_document_id = ${filter.param(input.knowledgeDocumentId)}::uuid)`)
    }
    // Filtro de Grupo/Subgrupo (249): algum vínculo naquele Subgrupo / Grupo (inteiro ou Subgrupo dele), uma linha por agente (`exists`).
    // Como antes, o filtro de Grupo não traz os de "todos os Grupos" (que têm filtro próprio).
    if (input.subteamId) filter.add(`exists (select 1 from agent_scope_links fl where fl.agent_id = q.id and fl.subteam_id = ${filter.param(input.subteamId)}::uuid)`)
    else if (input.teamId) filter.add(`exists (select 1 from agent_scope_links fl where fl.agent_id = q.id and fl.team_id = ${filter.param(input.teamId)}::uuid)`)
    else if (input.scopeType === "ALL_TEAMS") filter.add(`q."scopeType" = 'ALL_TEAMS'`)
    const manageable = manageableAgentScopeSql(scopes, (value) => filter.param(value))
    if (manageable) filter.add(manageable)
    // Inativos só aparecem para quem os administra, e só no alcance em que administra (PEN-001; servidor, não só a tela).
    const inactiveManageable = manageableAgentScopeSql(inactiveScopes, (value) => filter.param(value))
    if (inactiveManageable) filter.add(`(q.active or ${inactiveManageable})`)
    const data = await respondList(db, request.query, { select: AGENT_SELECT, filter, orderBy: 'q."usageCount" desc, q."createdAt" desc, q.id' })
    response.json({ data })
  })

  /**
   * Referências mínimas (nome, status, publicação e números de versão) de agentes citados por Workflows e orquestradores — inclusive
   * inativos, para o editor sinalizá-los (CA-009.12) sem abrir o cadastro deles a quem não é administrador (PEN-068).
   */
  /**
   * Associação a partir da base: os agentes que a pessoa administra, com a situação da base em cada um (em uso, no rascunho), o
   * rascunho (revisão, outras alterações pendentes) e o motivo quando a base não pode entrar. Exige ler a base E administrar agentes.
   */
  router.get("/knowledge-links", async (request, response) => {
    const user = sessionUser(request)
    const { knowledgeDocumentId, page, pageSize, ...filter } = knowledgeLinksQuerySchema.parse(request.query)
    const context = await loadKnowledgeLinkContext(db, user, knowledgeDocumentId)
    const listed = pageKnowledgeLinkCandidates(await loadKnowledgeLinkCandidates(db, user.organizationId, context), filter, page, pageSize)
    response.json({ data: { knowledgeDocument: { id: knowledgeDocumentId, title: context.knowledgeTitle, operatingUniverse: context.knowledgeUniverse }, ...listed } })
  })

  /**
   * Prévia (nada é gravado): o resultado em cada agente e, para quem seria publicado, a mesma prévia de impacto da publicação do
   * agente (consumidores afetados, restritos, quem perderia acesso). A confirmação na tela só é liberada com esta prévia carregada.
   * Um agente com problema (revisão desatualizada, alcance, universo) volta com o motivo — a gravação recusaria o lote inteiro.
   */
  router.post("/knowledge-links/preview", async (request, response) => {
    const user = sessionUser(request)
    const input = knowledgeLinksSchema.parse(request.body)
    const context = await loadKnowledgeLinkContext(db, user, input.knowledgeDocumentId)
    response.json({ data: await previewKnowledgeLinks(db, user, context, input) })
  })

  /**
   * Grava a associação em todos os agentes pedidos numa transação só (tudo ou nada), no rascunho de cada um ou publicando. Agente
   * publicado com outras alterações pendentes no rascunho recebe a base só no rascunho (não publica o que não é da base).
   */
  router.post("/knowledge-links", async (request, response) => {
    const user = sessionUser(request)
    const input = knowledgeLinksSchema.parse(request.body)
    const context = await loadKnowledgeLinkContext(db, user, input.knowledgeDocumentId)
    response.json({ data: await applyKnowledgeLinks(db, user.organizationId, context, input, actorOf(request)) })
  })

  router.get("/references", async (request, response) => {
    const user = sessionUser(request)
    const ids = (referencesSchema.parse(request.query).ids ?? "").split(",").map((id) => id.trim()).filter((id) => z.string().uuid().safeParse(id).success).slice(0, 200)
    if (ids.length === 0) return response.json({ data: [] })
    const scopes = await getManageableScopes(db, user, "agents.manage")
    const rows = (await db.query<{ id: string; name: string; agentType: string; active: boolean; published: boolean; currentVersionId: string | null; currentVersionNumber: number | null; scopeType: string; versions: { id: string; number: number; publishedAt: string }[] }>(
      `select a.id, a.name, a.agent_type "agentType", a.active, (a.current_version_id is not null) "published", a.current_version_id "currentVersionId", cv.version_number "currentVersionNumber",
              a.scope_type "scopeType",
              coalesce((select json_agg(json_build_object('id', v.id, 'number', v.version_number, 'publishedAt', v.published_at) order by v.version_number desc) from agent_versions v where v.agent_id = a.id), '[]') "versions"
         from agents a left join agent_versions cv on cv.id = a.current_version_id
        where a.organization_id = $1 and a.id = any($2::uuid[])`,
      [user.organizationId, ids],
    )).rows
    const links = await loadResourceScopeLinks(db, "AGENT", rows.map((row) => row.id))
    const managed = (row: (typeof rows)[number]) => canManageScope(scopes, scopedTargetOf(resourceScopeOf({ scopeType: row.scopeType === "ALL_TEAMS" ? "ALL_TEAMS" : "GROUPS", scopeLinks: links.get(row.id) ?? [] })))
    response.json({ data: rows.filter(managed).map((row) => ({ id: row.id, name: row.name, agentType: row.agentType, active: row.active, published: row.published, currentVersionId: row.currentVersionId, currentVersionNumber: row.currentVersionNumber, versions: row.versions })) })
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
    // Só consulta os alcances do agente quando há execução antiga (sem alcance de configuração guardado).
    const readsLegacyRuns = result.rows.some((row) => !row.configScope) && (await readsEveryAgentScope(db, sessionUser(request).organizationId, request.params.id!, access))
    response.json({ data: result.rows.map((row) => readableRun(access.scopes, row, readsLegacyRuns)) })
  })

  /** Uma execução com o conteúdo efetivamente testado (PEN-049: o teste do rascunho guarda o que foi testado) — se for do alcance de quem lê. */
  router.get("/:id/runs/:runId", async (request, response) => {
    const access = await authorizeAgent(db, request, request.params.id!)
    const row = (await db.query<{ testedConfig: (NonNullable<AgentScopeLike> & Record<string, unknown>) | null } & Record<string, unknown>>(
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
    if (!lifecycle) throw agentNotFound()
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
    // Alcance novo: todos os vínculos no alcance de quem cria, do universo do agente e com operador em produção (249).
    const scope = await resolveAgentScopeForWrite(db, organizationId, scopes, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null, scopeLinks: input.scopeLinks ?? [] }, { previous: null, universe: input.operatingUniverse ?? null })

    const specialty = (await specialtyFromInput(db, organizationId, input)) ?? { kind: null, domain: null, capability: null, acceptsConsolidated: false }
    const actionLimits: AgentActionLimits = { enabled: input.actionLimitsEnabled, text: actionLimitsText(input.actionLimits) }
    assertActionLimits(actionLimits)
    const config: AgentConfig = {
      name: input.name,
      agentType: input.agentType,
      objective: input.objective,
      description: input.description,
      contextPrompt: input.contextPrompt,
      ...agentScopeFields(scope),
      ...specialtyFields(specialty),
      recommendSupportMaterials: input.recommendSupportMaterials ?? false,
      investigationCapabilities: normalizeCapabilities(input.investigationCapabilities),
      actionLimitsEnabled: actionLimits.enabled,
      actionLimits: actionLimits.text,
      knowledgeDocumentIds: [...new Set(input.knowledgeDocumentIds)].sort(),
    }
    await assertKnowledge(db, organizationId, config)
    await assertUniverseRequiredFor(db, organizationId, input.operatingUniverse ?? null, "do agente")
    const agentId = await inTransaction(db, async (client) => {
      const created = await client.query<{ id: string }>(
        `insert into agents(organization_id, name, agent_type, objective, description, context_prompt, scope_type, team_id, subteam_id, created_by, draft_config, draft_revision, draft_updated_at, draft_updated_by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,now(),$12) returning id`,
        [organizationId, config.name, config.agentType, config.objective, config.description, config.contextPrompt, config.scopeType, null, null, request.user?.sub ?? null, JSON.stringify(config), actorOf(request).name],
      )
      const id = created.rows[0]!.id
      await client.query(`update agents set operating_universe = $2 where id = $1`, [id, input.operatingUniverse ?? null])
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
        if (!base) throw agentNotFound()
        // Sobrescrever o rascunho é agir sobre ele (como descartá-lo); `nextConfig` confere o alcance resultante.
        authorizeAgentConfig(access.scopes, base)
        // Vínculos já salvos (vigente ou rascunho) continuam aceitos; os novos, do universo do agente e com operador em produção (249).
        const config = await nextConfig(client, organizationId, access.scopes, base, changes, { previous: previousAgentScope(lifecycle.scope, agentScopeOf(base)), universe: access.operatingUniverse })
        await assertNameAvailable(client, organizationId, config.name, agentId)
        await saveDraftWithHistory(client, lifecycle, base, config, actorOf(request))
      }
      if (active !== undefined && active !== lifecycle.active) {
        await client.query(`update agents set active = $3, updated_at = now() where id = $1 and organization_id = $2`, [agentId, organizationId, active])
        await recordAgentHistory(client, organizationId, { agentId, action: "UPDATED", actor: actorOf(request), changes: [fieldChange("active", lifecycle.active ? "Ativo" : "Inativo", active ? "Ativo" : "Inativo")] })
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
      return publishCheckedDraft(client, lifecycle, access.scopes, actorOf(request))
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
      await recordAgentHistory(client, organizationId, { agentId, action: "DRAFT_DISCARDED", actor: actorOf(request), changes: [fieldChange("draft", "Alterações não publicadas", `Descartadas (volta à versão ${lifecycle.currentVersionNumber})`)] })
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
        fieldChange("version", versionLabel(lifecycle.currentVersionNumber), `Versão ${reverted.number} (configuração da versão ${source.summary.number})`),
        ...(reverted.discardedDraft ? [fieldChange("draft", "Alterações não publicadas", "Descartadas na reversão")] : []),
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
