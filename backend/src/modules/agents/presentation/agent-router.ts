import { Router } from "express"
import { z } from "zod"
import { INVESTIGATION_CAPABILITY_LABELS, investigationCapabilitySchema, normalizeCapabilities, type InvestigationCapability } from "../../investigation/domain/capabilities.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { booleanParam, dateParam, listParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { applyManageableScopeFilter, canManageScope, getManageableScopes, normalizeScopedTarget } from "../../auth/application/manageable-scopes.js"
import { agentBusinessDomainJoin, agentBusinessDomainJson, assertBusinessDomainsSelectable, resolveBusinessDomainRefs } from "../../business-domains/application/business-domain-lookup.js"
import { businessDomainCodeSchema } from "../../business-domains/domain/business-domain.js"
import { agentTextSchema } from "../domain/agent-field-limits.js"
import { actionLimitsProblem, describeActionLimits, type AgentActionLimits } from "../domain/action-limits.js"
import { describeSpecialtyProblem, legacySpecialtyFor, legacySpecialtySchema, resolveAgentSpecialty, specialtyKindSchema, type AgentSpecialty } from "../domain/agent-specialty.js"
import { runAgent } from "../application/run-agent.js"
import { buildSystemPrompt } from "../application/build-system-prompt.js"


const testAgentSchema = z.object({
  // Teto: o texto vai inteiro para o provedor de IA (custo) — uma transcrição longa cabe folgada.
  input: z.string().trim().min(10).max(100_000),
})

const agentSchema = z.object({
  name: agentTextSchema("name"),
  agentType: z.enum(["CALL_FEEDBACK", "INDICATOR_FEEDBACK", "DIAGNOSTICS", "ORCHESTRATOR", "HR", "CUSTOM"]),
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
  agentType: z.enum(["CALL_FEEDBACK", "INDICATOR_FEEDBACK", "DIAGNOSTICS", "ORCHESTRATOR", "HR", "CUSTOM"]).optional(),
  objective: agentTextSchema("objective").optional(),
  description: agentTextSchema("description").optional(),
  contextPrompt: agentTextSchema("contextPrompt").optional(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]).optional(),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  knowledgeDocumentIds: z.array(z.string().uuid()).optional(),
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
})

/** Texto vazio dos limites vira null (o interruptor desligado guarda o texto que houver). */
const actionLimitsText = (value: string | null | undefined) => (value?.trim() ? value.trim() : null)

/** Ligado sem texto: 422 antes de gravar (o banco também recusa — agents_action_limits_check). */
function assertActionLimits(limits: AgentActionLimits) {
  const problem = actionLimitsProblem(limits)
  if (problem) throw new DomainError(problem, "AGENT_ACTION_LIMITS_REQUIRED", 422)
}

/**
 * Entrada → especialidade tipada: a forma nova (`specialtyKind`…) prevalece; sem ela, a forma
 * legada (`specialty`) é traduzida pelo dual-read. `current` é o estado persistido (PATCH parcial).
 * O domínio de negócio é SEMPRE resolvido contra o catálogo (`business_domains`): por id
 * (`businessDomainId`), por código (`domain`) ou pelo código legado em `specialty`. Inexistente ⇒
 * 422 BUSINESS_DOMAIN_NOT_FOUND; inativo só passa se for o domínio que o Agent já tinha.
 */
async function specialtyFromInput(
  db: Database,
  organizationId: string,
  input: { specialtyKind?: string | null | undefined; businessDomainId?: string | null | undefined; domain?: string | null | undefined; capability?: string | null | undefined; consolidatedInput?: boolean | undefined; specialty?: string | null | undefined },
  current?: AgentSpecialty,
): Promise<AgentSpecialty | undefined> {
  const touchesNew = input.specialtyKind !== undefined || input.businessDomainId !== undefined || input.domain !== undefined || input.capability !== undefined || input.consolidatedInput !== undefined
  if (!touchesNew && input.specialty === undefined) return undefined
  const legacyOnly = !touchesNew ? resolveAgentSpecialty({ specialty: input.specialty }) : null
  const base = current ?? { kind: null, domain: null, capability: null, acceptsConsolidated: false }
  const kind = input.specialtyKind !== undefined ? input.specialtyKind : legacyOnly ? legacyOnly.kind : base.kind
  const domainSelector = input.businessDomainId !== undefined || input.domain !== undefined ? { ids: input.businessDomainId ? [input.businessDomainId] : [], codes: !input.businessDomainId && input.domain ? [input.domain] : [] } : legacyOnly ? { codes: legacyOnly.domain ? [legacyOnly.domain.code] : [] } : null
  let domain = base.domain
  if (domainSelector) {
    const refs = await resolveBusinessDomainRefs(db, organizationId, domainSelector)
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

const listAgentsSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  agentType: listParam(z.enum(["CALL_FEEDBACK", "INDICATOR_FEEDBACK", "DIAGNOSTICS", "ORCHESTRATOR", "HR", "CUSTOM"])),
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
    coalesce((
      select json_agg(json_build_object('id', kd.id, 'title', kd.title))
      from agent_knowledge_documents akd
      join knowledge_documents kd on kd.id = akd.knowledge_document_id
      where akd.agent_id = a.id
    ), '[]') "knowledgeDocuments"
  from agents a
  ${agentBusinessDomainJoin("a", "bd")}
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
}

type FieldChange = { field: string; label: string; from: string; to: string }

type AgentRow = {
  name: string
  agentType: string
  objective: string
  description: string
  contextPrompt: string
  active: boolean
  scopeType: string
  teamId: string | null
  subteamId: string | null
  investigationCapabilities?: string[] | null
  actionLimitsEnabled: boolean
  actionLimits: string | null
}

function diffIdList(field: string, before: string[], after: string[] | undefined): FieldChange | null {
  if (!after) return null
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  if (!added.length && !removed.length) return null
  const parts: string[] = []
  if (added.length) parts.push(`+${added.length}`)
  if (removed.length) parts.push(`-${removed.length}`)
  return { field, label: FIELD_LABELS[field]!, from: "", to: parts.join(" ") }
}

function diffAgentFields(
  before: AgentRow,
  input: { [K in keyof AgentRow]?: AgentRow[K] | undefined },
  knowledgeBefore: string[],
  knowledgeAfter: string[] | undefined,
  actionLimitsAfter: AgentActionLimits,
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of ["name", "agentType", "objective", "description", "contextPrompt"] as const) {
    if (input[field] !== undefined && input[field] !== before[field]) {
      changes.push({ field, label: FIELD_LABELS[field]!, from: String(before[field]), to: String(input[field]) })
    }
  }
  if (input.active !== undefined && input.active !== before.active) {
    changes.push({
      field: "active",
      label: FIELD_LABELS.active!,
      from: before.active ? "Ativo" : "Inativo",
      to: input.active ? "Ativo" : "Inativo",
    })
  }
  if (
    input.scopeType !== undefined &&
    (input.scopeType !== before.scopeType || input.teamId !== before.teamId || input.subteamId !== before.subteamId)
  ) {
    changes.push({
      field: "scopeType",
      label: FIELD_LABELS.scopeType!,
      from: before.scopeType,
      to: input.scopeType,
    })
  }
  const knowledgeChange = diffIdList("knowledgeDocumentIds", knowledgeBefore, knowledgeAfter)
  if (knowledgeChange) changes.push(knowledgeChange)
  const actionLimitsBefore = describeActionLimits({ enabled: before.actionLimitsEnabled, text: before.actionLimits })
  const actionLimitsNow = describeActionLimits(actionLimitsAfter)
  if (actionLimitsBefore !== actionLimitsNow) changes.push({ field: "actionLimits", label: FIELD_LABELS.actionLimits!, from: actionLimitsBefore, to: actionLimitsNow })
  if (input.investigationCapabilities !== undefined) {
    const from = normalizeCapabilities(before.investigationCapabilities ?? [])
    const to = normalizeCapabilities(input.investigationCapabilities)
    if (from.join(",") !== to.join(",")) {
      const label = (list: string[]) => (list.length === 0 ? "Nenhuma" : list.map((capability) => INVESTIGATION_CAPABILITY_LABELS[capability as InvestigationCapability] ?? capability).join(", "))
      changes.push({ field: "investigationCapabilities", label: FIELD_LABELS.investigationCapabilities!, from: label(from), to: label(to) })
    }
  }
  return changes
}

async function recordAgentHistory(
  client: { query: Database["query"] },
  organizationId: string,
  input: {
    agentId: string
    action: "CREATED" | "UPDATED" | "DUPLICATED"
    changedByPersonId: string | null
    changedByName: string
    changes: FieldChange[]
  },
) {
  await client.query(
    `insert into agent_history(organization_id, agent_id, action, changed_by_person_id, changed_by_name, changes)
     values ($1,$2,$3,$4,$5,$6)`,
    [organizationId, input.agentId, input.action, input.changedByPersonId, input.changedByName, JSON.stringify(input.changes)],
  )
}

/** Segurança de KB por código, não por confiança no id enviado pelo frontend: só bases da
 * organização e não excluídas podem ser autorizadas para um agente. */
async function assertKnowledgeDocumentsExist(client: { query: Database["query"] }, organizationId: string, knowledgeDocumentIds: string[]) {
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
 * Grupos" (só quem administra a organização cria) aceita qualquer base da organização. Lido do Agent já gravado nesta
 * transação (escopo novo, numa edição).
 */
async function assertKnowledgeDocumentsCompatible(client: { query: Database["query"] }, organizationId: string, agentId: string, knowledgeDocumentIds: string[]) {
  const uniqueIds = [...new Set(knowledgeDocumentIds)]
  if (uniqueIds.length === 0) return
  const compatible = await client.query<{ id: string }>(
    `with agent as (
       select a.scope_type, case when a.scope_type = 'SUBTEAM' then (select st.team_id from subteams st where st.id = a.subteam_id) else a.team_id end team_id from agents a where a.id = $3 and a.organization_id = $2
     )
     select d.id from knowledge_documents d, agent
      where d.id = any($1::uuid[]) and d.organization_id = $2 and d.deleted_at is null
        and (agent.scope_type = 'ALL_TEAMS' or exists (
          select 1 from knowledge_document_org_scopes os left join subteams st on st.id = os.subteam_id
           where os.knowledge_document_id = d.id and (os.scope_type = 'ALL_TEAMS' or coalesce(os.team_id, st.team_id) = agent.team_id)))`,
    [uniqueIds, organizationId, agentId],
  )
  if (compatible.rows.length !== uniqueIds.length) {
    throw new DomainError("Uma das bases de conhecimento selecionadas vale para outro Grupo — escolha bases globais ou do Grupo deste agente.", "AGENT_KNOWLEDGE_SCOPE_FORBIDDEN", 422)
  }
}

async function syncKnowledgeDocuments(client: { query: Database["query"] }, organizationId: string, agentId: string, knowledgeDocumentIds: string[]) {
  await assertKnowledgeDocumentsExist(client, organizationId, knowledgeDocumentIds)
  await assertKnowledgeDocumentsCompatible(client, organizationId, agentId, knowledgeDocumentIds)
  await client.query(`delete from agent_knowledge_documents where agent_id = $1`, [agentId])
  for (const knowledgeDocumentId of [...new Set(knowledgeDocumentIds)]) {
    await client.query(
      `insert into agent_knowledge_documents(agent_id, knowledge_document_id) values ($1,$2)`,
      [agentId, knowledgeDocumentId],
    )
  }
}

const NOT_FOUND = { error: { code: "AGENT_NOT_FOUND", message: "Agente não encontrado." } }

// Mesmo padrão de fetchScopedRow em workflow-router.ts — busca só o suficiente pra decidir
// autorização antes de qualquer leitura/gravação mais pesada.
async function fetchScopedAgentRow(db: Database, organizationId: string, id: string): Promise<{ scopeType: string; teamId: string | null; subteamId: string | null } | null> {
  const result = await db.query<{ scopeType: string; teamId: string | null; subteamId: string | null }>(
    `select scope_type "scopeType", team_id "teamId", subteam_id "subteamId" from agents where id = $1 and organization_id = $2`,
    [id, organizationId],
  )
  return result.rows[0] ?? null
}

export function createAgentRouter(db: Database) {
  const router = Router()

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = listAgentsSchema.parse(request.query)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.name", "q.objective", "q.description"])
      .in('q."agentType"', input.agentType)
      .equals("q.active", input.active)
      .orgScope("q", input)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    if (input.knowledgeDocumentId) {
      filter.add(`exists (select 1 from agent_knowledge_documents akd where akd.agent_id = q.id and akd.knowledge_document_id = ${filter.param(input.knowledgeDocumentId)}::uuid)`)
    }
    applyManageableScopeFilter(scopes, filter)
    const data = await respondList(db, request.query, { select: AGENT_SELECT, filter, orderBy: 'q."usageCount" desc, q."createdAt" desc, q.id' })
    response.json({ data })
  })

  router.get("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchScopedAgentRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    const result = await db.query(`${AGENT_SELECT} and a.id = $2`, [organizationId, request.params.id])
    response.json({ data: result.rows[0] })
  })

  router.get("/:id/history", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchScopedAgentRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    const result = await db.query(
      `select id, action, changed_by_name "changedByName", changes, created_at "createdAt"
       from agent_history
       where agent_id = $1 and organization_id = $2
       order by created_at desc`,
      [request.params.id, organizationId],
    )
    response.json({ data: result.rows })
  })

  router.get("/:id/runs", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchScopedAgentRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    const result = await db.query(
      `select id, source, input_context "inputContext", output_text "outputText", status, error_message "errorMessage",
              model, case_id "caseId", created_at "createdAt", completed_at "completedAt"
       from agent_runs
       where agent_id = $1 and organization_id = $2
       order by created_at desc
       limit 50`,
      [request.params.id, organizationId],
    )
    response.json({ data: result.rows })
  })

  router.get("/:id/preview-prompt", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchScopedAgentRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    const agentResult = await db.query<{ organization_id: string; name: string; objective: string; description: string; context_prompt: string }>(
      `select organization_id, name, objective, description, context_prompt from agents where id = $1 and organization_id = $2`,
      [request.params.id, organizationId],
    )
    const agent = agentResult.rows[0]!
    const prompt = await buildSystemPrompt(db, request.params.id!, agent)
    response.json({ data: { prompt } })
  })

  router.post("/:id/test", async (request, response) => {
    const current = await fetchScopedAgentRow(db, request.user!.organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    const input = testAgentSchema.parse(request.body)
    const run = await runAgent(db, { organizationId: request.user!.organizationId, agentId: request.params.id!, inputContext: input.input, source: "MANUAL_TEST" })
    response.status(201).json({ data: run })
  })

  router.post("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = agentSchema.parse(request.body)

    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    const scope = await normalizeScopedTarget(db, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null })
    if (!scope || !canManageScope(scopes, scope)) {
      throw new DomainError("Você não tem permissão para criar agentes nesse escopo.", "AGENT_SCOPE_FORBIDDEN", 403)
    }

    const specialty = (await specialtyFromInput(db, organizationId, input)) ?? { kind: null, domain: null, capability: null, acceptsConsolidated: false }
    const actionLimits: AgentActionLimits = { enabled: input.actionLimitsEnabled, text: actionLimitsText(input.actionLimits) }
    assertActionLimits(actionLimits)
    const client = await db.connect()
    try {
      await client.query("begin")
      const created = await client.query<{ id: string }>(
        `insert into agents(organization_id, name, agent_type, objective, description, context_prompt, scope_type, team_id, subteam_id, created_by, specialty, specialty_kind, domain, capability, consolidated_input, business_domain_id, recommend_support_materials, investigation_capabilities, action_limits_enabled, action_limits)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning id`,
        [
          organizationId,
          input.name,
          input.agentType,
          input.objective,
          input.description,
          input.contextPrompt,
          scope.scopeType,
          scope.teamId,
          scope.subteamId,
          request.user?.sub ?? null,
          legacySpecialtyFor(specialty),
          specialty.kind,
          specialty.domain?.code ?? null,
          specialty.capability,
          specialty.acceptsConsolidated,
          specialty.domain?.id ?? null,
          input.recommendSupportMaterials ?? false,
          normalizeCapabilities(input.investigationCapabilities),
          actionLimits.enabled,
          actionLimits.text,
        ],
      )
      const agentId = created.rows[0]!.id
      await syncKnowledgeDocuments(client, organizationId, agentId, input.knowledgeDocumentIds)
      await recordAgentHistory(client, organizationId, {
        agentId,
        action: "CREATED",
        changedByPersonId: request.user?.personId ?? null,
        changedByName: request.user?.name ?? "Sistema",
        changes: [],
      })
      await client.query("commit")
      const result = await db.query(`${AGENT_SELECT} and a.id = $2`, [organizationId, agentId])
      response.status(201).json({ data: result.rows[0] })
    } catch (error) {
      await client.query("rollback")
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("Já existe um agente com esse nome.", "AGENT_NAME_TAKEN", 409)
      }
      throw error
    } finally {
      client.release()
    }
  })

  router.patch("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = updateAgentSchema.parse(request.body)
    const client = await db.connect()
    try {
      await client.query("begin")
      const before = await client.query<AgentRow>(
        `select name, agent_type "agentType", objective, description, context_prompt "contextPrompt", active,
                scope_type "scopeType", team_id "teamId", subteam_id "subteamId",
                action_limits_enabled "actionLimitsEnabled", action_limits "actionLimits"
         from agents where id = $1 and organization_id = $2`,
        [request.params.id, organizationId],
      )
      if (!before.rows[0]) {
        await client.query("rollback")
        return response.status(404).json(NOT_FOUND)
      }

      const scopes = await getManageableScopes(db, request.user!, "agents.manage")
      if (!canManageScope(scopes, before.rows[0])) {
        await client.query("rollback")
        return response.status(404).json(NOT_FOUND)
      }
      const nextScope = input.scopeType !== undefined ? await normalizeScopedTarget(client, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null }) : null
      if (input.scopeType !== undefined && (!nextScope || !canManageScope(scopes, nextScope))) {
        await client.query("rollback")
        throw new DomainError("Você não tem permissão para mover o agente para esse escopo.", "AGENT_SCOPE_FORBIDDEN", 403)
      }

      const knowledgeBefore = await client.query<{ knowledge_document_id: string }>(
        `select knowledge_document_id from agent_knowledge_documents where agent_id = $1`,
        [request.params.id],
      )
      // Estado final dos limites (PATCH parcial): o que não veio continua como está.
      const nextActionLimits: AgentActionLimits = {
        enabled: input.actionLimitsEnabled ?? before.rows[0].actionLimitsEnabled,
        text: input.actionLimits !== undefined ? actionLimitsText(input.actionLimits) : before.rows[0].actionLimits,
      }
      assertActionLimits(nextActionLimits)
      const currentSpecialtyRow = await client.query<{ specialty: string | null; specialty_kind: string | null; domain: string | null; capability: string | null; consolidated_input: boolean; business_domain_id: string | null; business_domain_code: string | null; business_domain_name: string | null; business_domain_active: boolean | null }>(
        `select a.specialty, a.specialty_kind, a.domain, a.capability, a.consolidated_input, bd.id "business_domain_id", bd.code "business_domain_code", bd.name "business_domain_name", bd.active "business_domain_active"
           from agents a ${agentBusinessDomainJoin("a", "bd")} where a.id = $1 and a.organization_id = $2`,
        [request.params.id, organizationId],
      )
      const nextSpecialty = currentSpecialtyRow.rows[0] ? await specialtyFromInput(db, organizationId, input, resolveAgentSpecialty(currentSpecialtyRow.rows[0])) : undefined
      const updated = await client.query(
        `update agents set
           name = coalesce($1, name),
           agent_type = coalesce($2, agent_type),
           objective = coalesce($3, objective),
           description = coalesce($4, description),
           context_prompt = coalesce($5, context_prompt),
           active = coalesce($6, active),
           scope_type = coalesce($7, scope_type),
           team_id = case when $7 is not null then $8 else team_id end,
           subteam_id = case when $7 is not null then $9 else subteam_id end,
           specialty = case when $12::boolean then $13 else specialty end,
           specialty_kind = case when $12::boolean then $14 else specialty_kind end,
           domain = case when $12::boolean then $15 else domain end,
           capability = case when $12::boolean then $16 else capability end,
           consolidated_input = case when $12::boolean then $17::boolean else consolidated_input end,
           business_domain_id = case when $12::boolean then $18::uuid else business_domain_id end,
           recommend_support_materials = coalesce($19, recommend_support_materials),
           investigation_capabilities = coalesce($20::text[], investigation_capabilities),
           action_limits_enabled = $21,
           action_limits = $22,
           updated_at = now()
         where id = $10 and organization_id = $11
         returning id`,
        [
          input.name ?? null,
          input.agentType ?? null,
          input.objective ?? null,
          input.description ?? null,
          input.contextPrompt ?? null,
          input.active ?? null,
          nextScope?.scopeType ?? null,
          nextScope?.teamId ?? null,
          nextScope?.subteamId ?? null,
          request.params.id,
          organizationId,
          nextSpecialty !== undefined,
          nextSpecialty ? legacySpecialtyFor(nextSpecialty) : null,
          nextSpecialty?.kind ?? null,
          nextSpecialty?.domain?.code ?? null,
          nextSpecialty?.capability ?? null,
          nextSpecialty?.acceptsConsolidated ?? false,
          nextSpecialty?.domain?.id ?? null,
          input.recommendSupportMaterials ?? null,
          input.investigationCapabilities ? normalizeCapabilities(input.investigationCapabilities) : null,
          nextActionLimits.enabled,
          nextActionLimits.text,
        ],
      )
      if (!updated.rows[0]) {
        await client.query("rollback")
        return response.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "Agente não encontrado." } })
      }
      if (input.knowledgeDocumentIds) {
        await syncKnowledgeDocuments(client, organizationId, request.params.id, input.knowledgeDocumentIds)
      }
      const changes = diffAgentFields(
        before.rows[0]!,
        input,
        knowledgeBefore.rows.map((row) => row.knowledge_document_id),
        input.knowledgeDocumentIds,
        nextActionLimits,
      )
      if (changes.length > 0) {
        await recordAgentHistory(client, organizationId, {
          agentId: request.params.id!,
          action: "UPDATED",
          changedByPersonId: request.user?.personId ?? null,
          changedByName: request.user?.name ?? "Sistema",
          changes,
        })
      }
      await client.query("commit")
      const result = await db.query(`${AGENT_SELECT} and a.id = $2`, [organizationId, request.params.id])
      return response.json({ data: result.rows[0] })
    } catch (error) {
      await client.query("rollback")
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("Já existe um agente com esse nome.", "AGENT_NAME_TAKEN", 409)
      }
      throw error
    } finally {
      client.release()
    }
  })

  router.delete("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchScopedAgentRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    await db.query(`delete from agents where id = $1 and organization_id = $2`, [request.params.id, organizationId])
    response.status(204).send()
  })

  return router
}
