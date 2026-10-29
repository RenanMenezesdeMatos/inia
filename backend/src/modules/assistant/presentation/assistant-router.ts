import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { booleanParam, dateParam, listParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"
import { applyManageableScopeFilter, canManageScope, getManageableScopes, normalizeScopedTarget, scopesAreCompatible, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { createOrchestratorSchema, updateOrchestratorSchema, toolNameForAgent } from "../domain/orchestrator-schema.js"
import { checkSpecialistAgainstRouting, describeRoutingProblem, legacyPolicyFor, POLICY_REQUIRED_MESSAGE, resolveRoutingPolicy, type OrchestratorPolicy, type RoutingPolicy } from "../domain/orchestrator-policy.js"
import { resolveAgentSpecialty } from "../../agents/domain/agent-specialty.js"
import { agentBusinessDomainColumns, agentBusinessDomainJoin, agentBusinessDomainJson, assertBusinessDomainsSelectable, orchestratorBusinessDomainsJson, resolveBusinessDomainRefs, syncOrchestratorBusinessDomains } from "../../business-domains/application/business-domain-lookup.js"
import type { BusinessDomainRef } from "../../business-domains/domain/business-domain.js"
import {
  buildStructuredOutputContract,
  parseStructuredOutputDefinition,
  resolveEffectiveStructuredOutput,
  StructuredOutputDefinitionError,
  toLegacyOutputSchema,
  type StructuredOutputDefinition,
} from "../domain/structured-output-definition.js"
import { assertStructuredOutputChangeAllowed, loadStructuredOutputUsage } from "../application/structured-output-dependencies.js"


const NOT_FOUND = { error: { code: "ORCHESTRATOR_NOT_FOUND", message: "Orquestrador não encontrado." } }

const listOrchestratorsSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  active: booleanParam,
  invocationMode: listParam(z.enum(["INTERACTIVE", "WORKFLOW", "BOTH"])),
  orchestratorAgentId: z.string().uuid().optional(),
  specialistAgentId: z.string().uuid().optional(),
  createdFrom: dateParam,
  createdTo: dateParam,
})

const ORCHESTRATOR_SELECT = `
  select
    o.id, o.name, o.scope_type "scopeType", o.team_id "teamId", t.name "teamName",
    o.subteam_id "subteamId", st.name "subteamName", o.active, o.created_at "createdAt",
    o.invocation_mode "invocationMode", o.output_instructions "outputInstructions", o.output_schema "outputSchema",
    o.structured_output "structuredOutputRaw", o.recommend_support_materials "recommendSupportMaterials",
    o.orchestrator_agent_id "orchestratorAgentId", oa.name "orchestratorAgentName",
    o.policy_kind "policyKind", o.policy_domains "policyDomains",
    o.routing_policy "routingPolicy", o.routing_domains "routingDomains",
    ${orchestratorBusinessDomainsJson("o")} "businessDomains",
    coalesce((
      select json_agg(json_build_object('agentId', s.agent_id, 'agentName', sa.name, 'agentType', sa.agent_type, 'specialty', sa.specialty, 'specialtyKind', sa.specialty_kind, 'domain', sa.domain, 'capability', sa.capability, 'businessDomainId', sa.business_domain_id, 'businessDomain', ${agentBusinessDomainJson("sbd")}) order by sa.name)
      from assistant_orchestrator_specialists s
      join agents sa on sa.id = s.agent_id
      ${agentBusinessDomainJoin("sa", "sbd")}
      where s.orchestrator_id = o.id
    ), '[]') "specialists"
  from assistant_orchestrators o
  join agents oa on oa.id = o.orchestrator_agent_id
  left join teams t on t.id = o.team_id
  left join subteams st on st.id = o.subteam_id
  where o.organization_id = $1
`

/**
 * Resultado estruturado na resposta da API (dual-read, structured-output-definition.ts): a
 * definição efetiva (persistida ou reconstruída do legado), de onde ela veio, a revisão pendente
 * de um legado divergente e o catálogo de campos já achatado (paths + labels) — o Workflow
 * Builder lê daqui, nunca recalcula. As colunas legadas continuam na resposta por compatibilidade.
 */
function decorateOrchestratorRow<T extends { structuredOutputRaw?: unknown; outputSchema?: unknown; outputInstructions?: string | null }>(row: T) {
  const { structuredOutputRaw, ...rest } = row
  const effective = resolveEffectiveStructuredOutput({ structured_output: structuredOutputRaw, output_schema: row.outputSchema, output_instructions: row.outputInstructions ?? null })
  return {
    ...rest,
    structuredOutput: effective.definition,
    structuredOutputSource: effective.source,
    structuredOutputReview: effective.review,
    structuredOutputFields: effective.fields,
  }
}

/**
 * Entrada → colunas persistidas do resultado estruturado. `structuredOutput` presente = fonte da
 * verdade nova: as colunas legadas são GERADAS (contrato para o modelo + metadado grupo › campo
 * quando representável) — o admin nunca edita as duas; null explícito desliga tudo. Ausente =
 * contrato antigo da API (outputInstructions/outputSchema soltos), preservado por compatibilidade.
 */
function structuredOutputColumns(input: { structuredOutput?: unknown; outputInstructions?: string | null | undefined; outputSchema?: unknown }): {
  definition: StructuredOutputDefinition | null
  touchesDefinition: boolean
  outputInstructions: string | null | undefined
  outputSchema: unknown
} {
  if (input.structuredOutput === undefined) {
    return { definition: null, touchesDefinition: false, outputInstructions: input.outputInstructions, outputSchema: input.outputSchema }
  }
  if (input.structuredOutput === null) return { definition: null, touchesDefinition: true, outputInstructions: null, outputSchema: null }
  try {
    const definition = parseStructuredOutputDefinition(input.structuredOutput)
    return { definition, touchesDefinition: true, outputInstructions: buildStructuredOutputContract(definition), outputSchema: toLegacyOutputSchema(definition) }
  } catch (error) {
    if (error instanceof StructuredOutputDefinitionError) throw new DomainError(error.message, "STRUCTURED_OUTPUT_INVALID", 422, { issues: error.issues })
    throw error
  }
}

async function fetchScopedRow(
  db: Database,
  organizationId: string,
  id: string,
): Promise<{ scopeType: string; teamId: string | null; subteamId: string | null } | null> {
  const result = await db.query<{ scopeType: string; teamId: string | null; subteamId: string | null }>(
    `select scope_type "scopeType", team_id "teamId", subteam_id "subteamId" from assistant_orchestrators where id = $1 and organization_id = $2`,
    [id, organizationId],
  )
  return result.rows[0] ?? null
}

async function validateOrchestratorAgent(db: Database, organizationId: string, agentId: string): Promise<void> {
  const result = await db.query<{ agent_type: string }>(`select agent_type from agents where id = $1 and organization_id = $2`, [
    agentId,
    organizationId,
  ])
  const agentType = result.rows[0]?.agent_type
  if (!agentType) throw new DomainError("Agente orquestrador não encontrado.", "ORCHESTRATOR_AGENT_NOT_FOUND", 404)
  if (agentType !== "ORCHESTRATOR") {
    throw new DomainError(
      'O agente escolhido precisa ser do tipo "Orquestrador" — crie ou escolha um agente desse tipo em Agentes.',
      "ORCHESTRATOR_AGENT_WRONG_TYPE",
      422,
    )
  }
}

/**
 * Nunca vazamento cross-group (Parte 6/24 do pedido): o agente orquestrador e cada especialista
 * de um Orchestrator precisam estar disponíveis pro escopo DELE — um Orchestrator FATURAS não
 * pode silenciosamente usar um Agent exclusivo de RETENÇÃO. Reaproveita scopesAreCompatible,
 * mesma função usada pra validar Orchestrator dentro de um Workflow.
 */
async function validateAgentsCompatibleWithScope(db: Database, orchestratorScope: ScopedTarget, agentIds: string[]): Promise<void> {
  if (agentIds.length === 0) return
  const uniqueIds = [...new Set(agentIds)]
  const agentRows = await db.query<{ id: string; name: string; scopeType: string; teamId: string | null; subteamId: string | null }>(
    `select id, name, scope_type "scopeType", team_id "teamId", subteam_id "subteamId" from agents where id = any($1::uuid[])`,
    [uniqueIds],
  )
  const foundIds = new Set(agentRows.rows.map((row) => row.id))
  const missingId = uniqueIds.find((id) => !foundIds.has(id))
  if (missingId) throw new DomainError("Um dos agentes selecionados não existe mais.", "ORCHESTRATOR_AGENT_NOT_FOUND", 404)
  for (const agent of agentRows.rows) {
    if (!(await scopesAreCompatible(db, orchestratorScope, agent))) {
      throw new DomainError(`O agente "${agent.name}" não está disponível para o grupo deste orquestrador.`, "ORCHESTRATOR_AGENT_SCOPE_FORBIDDEN", 422)
    }
  }
}

/**
 * Política de roteamento (orchestrator-policy.ts): um Orquestrador só aceita especialistas que a
 * sua política permite — DOMAINS: o domínio do Agent precisa estar na lista, transversal entra se
 * listado, performance/síntese nunca; OPEN: qualquer especialidade listada, exceto síntese. Legado
 * TRANSVERSAL/MANAGERIAL continua com a regra antiga. Validado aqui, na configuração (422 com o
 * motivo e o `agentId`), e não só no runtime; o prompt do coordenador não é segurança.
 */
async function validateSpecialistsAgainstRouting(db: Database, routing: RoutingPolicy, specialistAgentIds: string[], usage: { active: boolean; invocationMode: string }): Promise<void> {
  // Ativo sem política é o escape que a migration 054 fechou — recusado aqui com código próprio
  // (a UI aponta o campo); domínios incoerentes e o legado INTERACTIVE fora de "Só chat/voz" caem
  // em ORCHESTRATOR_POLICY_INVALID.
  if (usage.active && routing.kind === null) throw new DomainError(POLICY_REQUIRED_MESSAGE, "ORCHESTRATOR_POLICY_REQUIRED", 422)
  const problem = describeRoutingProblem(routing, usage)
  if (problem) throw new DomainError(problem, "ORCHESTRATOR_POLICY_INVALID", 422)
  if (routing.kind === null || specialistAgentIds.length === 0) return
  const rows = await db.query<{ id: string; name: string; specialty: string | null; specialty_kind: string | null; domain: string | null; capability: string | null; consolidated_input: boolean | null; business_domain_id: string | null; business_domain_code: string | null; business_domain_name: string | null; business_domain_active: boolean | null }>(
    `select ag.id, ag.name, ag.specialty, ag.specialty_kind, ag.domain, ag.capability, ag.consolidated_input, ${agentBusinessDomainColumns("bd")}
       from agents ag ${agentBusinessDomainJoin("ag", "bd")}
      where ag.id = any($1::uuid[])`,
    [[...new Set(specialistAgentIds)]],
  )
  for (const row of rows.rows) {
    const specialty = resolveAgentSpecialty(row)
    const verdict = checkSpecialistAgainstRouting(routing, { name: row.name, specialty: { kind: specialty.kind, domain: specialty.domain } })
    if (!verdict.allowed) throw new DomainError(verdict.reason, "ORCHESTRATOR_SPECIALIST_FORBIDDEN_BY_POLICY", 422, { agentId: row.id })
  }
}

/**
 * Entrada da API → política de roteamento: a forma nova (`routingPolicy` + `routingDomainIds` por
 * id do catálogo, ou `routingDomains` por código) prevalece; sem ela, a forma legada
 * (`policyKind/policyDomains`) é traduzida pelo mesmo dual-read. Os domínios são SEMPRE resolvidos
 * contra `business_domains` (id/código inexistente ⇒ 422); domínio inativo só passa se já estava
 * vinculado antes desta edição — o backend é a autoridade, o frontend só filtra.
 */
type RoutingInput = { routingPolicy?: string | null | undefined; routingDomainIds?: string[] | undefined; routingDomains?: string[] | undefined; policyKind?: string | null | undefined; policyDomains?: string[] | undefined }
async function routingFromInput(db: Database, organizationId: string, input: RoutingInput, current?: RoutingPolicy): Promise<RoutingPolicy> {
  const currentDomains: BusinessDomainRef[] = current?.kind === "DOMAINS" ? current.domains : current?.kind === "LEGACY" ? current.legacy.domains : []
  const currentCodes = currentDomains.map((domain) => domain.code)
  const touchesDomains = input.routingDomainIds !== undefined || input.routingDomains !== undefined
  const resolveInputDomains = async (codes?: string[]): Promise<BusinessDomainRef[]> => {
    const refs = await resolveBusinessDomainRefs(db, organizationId, { ids: input.routingDomainIds, codes: codes ?? input.routingDomains })
    assertBusinessDomainsSelectable(refs, currentCodes)
    return refs
  }
  if (input.routingPolicy !== undefined) {
    if (input.routingPolicy === "DOMAINS") return { kind: "DOMAINS", domains: touchesDomains ? await resolveInputDomains() : currentDomains }
    return resolveRoutingPolicy({ routing_policy: input.routingPolicy })
  }
  if (touchesDomains && current?.kind === "DOMAINS") return { kind: "DOMAINS", domains: await resolveInputDomains() }
  if (input.policyKind !== undefined || input.policyDomains !== undefined) {
    const legacyCurrent = current ? legacyPolicyFor(current, "WORKFLOW") : { kind: null, domains: [] }
    const domains = input.policyDomains !== undefined ? await resolveInputDomains(input.policyDomains) : legacyCurrent.domains
    return resolveRoutingPolicy({ policy_kind: input.policyKind !== undefined ? input.policyKind : legacyCurrent.kind, business_domains: domains.filter((domain) => domain.id), policy_domains: domains.map((domain) => domain.code) })
  }
  return current ?? { kind: null }
}

/** Colunas persistidas (dual-write): forma nova (relação por id, gravada à parte) + códigos nas
 * colunas legadas `routing_domains`/`policy_kind`/`policy_domains`. */
function persistedPolicyColumns(routing: RoutingPolicy, invocationMode: string): { routingPolicy: string | null; routingDomains: string[]; legacy: OrchestratorPolicy; legacyDomainCodes: string[]; domainRefs: BusinessDomainRef[] } {
  const legacy = legacyPolicyFor(routing, invocationMode)
  const domainRefs = routing.kind === "DOMAINS" ? routing.domains : routing.kind === "LEGACY" ? routing.legacy.domains : []
  return {
    routingPolicy: routing.kind === "DOMAINS" || routing.kind === "OPEN" ? routing.kind : null,
    routingDomains: routing.kind === "DOMAINS" ? routing.domains.map((domain) => domain.code) : [],
    legacy,
    legacyDomainCodes: legacy.domains.map((domain) => domain.code),
    domainRefs,
  }
}

function rethrowFriendly(error: unknown): never {
  if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "uq_assistant_orchestrator_active_scope") {
    throw new DomainError(
      "Já existe um orquestrador ativo atendendo o chat/voz nesse escopo — desative-o, ou restrinja um dos dois a \"Somente Workflow\", pra evitar que os dois disputem quem responde o operador.",
      "ORCHESTRATOR_SCOPE_TAKEN",
      409,
    )
  }
  throw error
}

async function syncSpecialists(client: { query: Database["query"] }, orchestratorId: string, specialistAgentIds: string[]) {
  await client.query(`delete from assistant_orchestrator_specialists where orchestrator_id = $1`, [orchestratorId])
  for (const agentId of specialistAgentIds) {
    await client.query(
      `insert into assistant_orchestrator_specialists(orchestrator_id, agent_id, tool_name) values ($1,$2,$3)`,
      [orchestratorId, agentId, toolNameForAgent(agentId)],
    )
  }
}

export function createAssistantRouter(db: Database) {
  const router = Router()

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = listOrchestratorsSchema.parse(request.query)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.name", 'q."orchestratorAgentName"'])
      .equals("q.active", input.active)
      .in('q."invocationMode"', input.invocationMode)
      .equals('q."orchestratorAgentId"', input.orchestratorAgentId)
      .orgScope("q", input)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    if (input.specialistAgentId) {
      filter.add(`exists (select 1 from assistant_orchestrator_specialists s where s.orchestrator_id = q.id and s.agent_id = ${filter.param(input.specialistAgentId)}::uuid)`)
    }
    applyManageableScopeFilter(scopes, filter)
    const data = await respondList<{ structuredOutputRaw?: unknown; outputSchema?: unknown; outputInstructions?: string | null }>(db, request.query, { select: ORCHESTRATOR_SELECT, filter, orderBy: 'q."createdAt" desc, q.id' })
    response.json({ data: Array.isArray(data) ? data.map(decorateOrchestratorRow) : { ...data, items: data.items.map(decorateOrchestratorRow) } })
  })

  router.get("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const result = await db.query(`${ORCHESTRATOR_SELECT} and o.id = $2`, [organizationId, request.params.id])
    if (!result.rows[0]) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, result.rows[0])) return response.status(404).json(NOT_FOUND)
    response.json({ data: decorateOrchestratorRow(result.rows[0]) })
  })

  /** Onde cada path do resultado estruturado é usado (Workflows em rascunho/publicados) — a UI
   * mostra o impacto ANTES de apagar/renomear; a gravação aplica a mesma regra. */
  router.get("/:id/structured-output-usage", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)
    response.json({ data: await loadStructuredOutputUsage(db, organizationId, request.params.id!) })
  })

  router.post("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = createOrchestratorSchema.parse(request.body)

    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    const newScope = await normalizeScopedTarget(db, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null })
    if (!newScope || !canManageScope(scopes, newScope)) {
      throw new DomainError("Você não tem permissão para criar um orquestrador nesse escopo.", "ORCHESTRATOR_SCOPE_FORBIDDEN", 403)
    }
    await validateOrchestratorAgent(db, organizationId, input.orchestratorAgentId)
    await validateAgentsCompatibleWithScope(db, newScope, [input.orchestratorAgentId, ...input.specialistAgentIds])
    const routing = await routingFromInput(db, organizationId, input)
    // Criação sempre nasce ativa (a coluna `active` tem default true) — logo sempre exige política.
    await validateSpecialistsAgainstRouting(db, routing, input.specialistAgentIds, { active: true, invocationMode: input.invocationMode })
    const persisted = persistedPolicyColumns(routing, input.invocationMode)
    const structured = structuredOutputColumns(input)

    try {
      const orchestratorId = await inTransaction(db, async (client) => {
        const created = await client.query<{ id: string }>(
          `insert into assistant_orchestrators(organization_id, name, scope_type, team_id, subteam_id, orchestrator_agent_id, invocation_mode, output_instructions, output_schema, created_by, policy_kind, policy_domains, routing_policy, routing_domains, structured_output, recommend_support_materials)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
          [
            organizationId,
            input.name,
            newScope.scopeType,
            newScope.teamId,
            newScope.subteamId,
            input.orchestratorAgentId,
            input.invocationMode,
            structured.outputInstructions ?? null,
            structured.outputSchema ? JSON.stringify(structured.outputSchema) : null,
            request.user?.personId ?? null,
            persisted.legacy.kind,
            persisted.legacyDomainCodes,
            persisted.routingPolicy,
            persisted.routingDomains,
            structured.definition ? JSON.stringify(structured.definition) : null,
            input.recommendSupportMaterials ?? false,
          ],
        )
        const orchestratorId = created.rows[0]!.id
        await syncOrchestratorBusinessDomains(client, orchestratorId, persisted.domainRefs)
        await syncSpecialists(client, orchestratorId, input.specialistAgentIds)
        return orchestratorId
      })
      const result = await db.query(`${ORCHESTRATOR_SELECT} and o.id = $2`, [organizationId, orchestratorId])
      response.status(201).json({ data: decorateOrchestratorRow(result.rows[0]) })
    } catch (error) {
      rethrowFriendly(error)
    }
  })

  router.patch("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = updateOrchestratorSchema.parse(request.body)
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)

    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    const movedScope = input.scopeType !== undefined ? await normalizeScopedTarget(db, organizationId, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null }) : null
    if (input.scopeType !== undefined && (!movedScope || !canManageScope(scopes, movedScope))) {
      throw new DomainError("Você não tem permissão para mover o orquestrador para esse escopo.", "ORCHESTRATOR_SCOPE_FORBIDDEN", 403)
    }
    if (input.orchestratorAgentId) await validateOrchestratorAgent(db, organizationId, input.orchestratorAgentId)
    const nextScope: ScopedTarget = movedScope ?? { scopeType: current.scopeType, teamId: current.teamId, subteamId: current.subteamId }
    const agentIdsToValidate = [...(input.orchestratorAgentId ? [input.orchestratorAgentId] : []), ...(input.specialistAgentIds ?? [])]
    await validateAgentsCompatibleWithScope(db, nextScope, agentIdsToValidate)
    // Se só o escopo mudou (sem mexer nos especialistas), os já vinculados também precisam
    // continuar compatíveis com o escopo NOVO — mesma regra do Workflow ao trocar Abrangência.
    const currentSpecialists = await db.query<{ agent_id: string }>(`select agent_id from assistant_orchestrator_specialists where orchestrator_id = $1`, [
      request.params.id,
    ])
    if (input.scopeType !== undefined && !input.specialistAgentIds) {
      await validateAgentsCompatibleWithScope(db, nextScope, currentSpecialists.rows.map((row) => row.agent_id))
    }
    // Política: a lista FINAL de especialistas (nova ou a atual) contra a política FINAL (nova ou a
    // atual) — trocar só a política também reavalia quem já está vinculado.
    const currentPolicyRow = await db.query<{ policy_kind: string | null; policy_domains: string[]; routing_policy: string | null; routing_domains: string[]; business_domains: unknown; active: boolean; invocation_mode: string }>(
      `select o.policy_kind, o.policy_domains, o.routing_policy, o.routing_domains, ${orchestratorBusinessDomainsJson("o")} business_domains, o.active, o.invocation_mode from assistant_orchestrators o where o.id = $1 and o.organization_id = $2`,
      [request.params.id, organizationId],
    )
    const currentRouting = resolveRoutingPolicy(currentPolicyRow.rows[0] ?? {})
    const nextRouting = await routingFromInput(db, organizationId, input, currentRouting)
    // Estado FINAL do registro (ativo? modo?) — reativar um legado sem política é recusado aqui,
    // não só pela constraint do banco.
    const nextUsage = {
      active: input.active ?? currentPolicyRow.rows[0]?.active ?? true,
      invocationMode: input.invocationMode ?? currentPolicyRow.rows[0]?.invocation_mode ?? "BOTH",
    }
    await validateSpecialistsAgainstRouting(db, nextRouting, input.specialistAgentIds ?? currentSpecialists.rows.map((row) => row.agent_id), nextUsage)
    const persisted = persistedPolicyColumns(nextRouting, nextUsage.invocationMode)
    const structured = structuredOutputColumns(input)
    if (structured.touchesDefinition) {
      // Mudança potencialmente breaking (path removido/renomeado, tipo, opção) contra o uso real
      // em Workflows — a definição ANTERIOR é a efetiva (persistida ou legado convertido), então
      // um legado que perde um campo na primeira gravação pela tela nova também é detectado.
      const previousRow = await db.query<{ structured_output: unknown; output_schema: unknown; output_instructions: string | null }>(
        `select structured_output, output_schema, output_instructions from assistant_orchestrators where id = $1 and organization_id = $2`,
        [request.params.id, organizationId],
      )
      const previous = previousRow.rows[0] ? resolveEffectiveStructuredOutput(previousRow.rows[0]).definition : null
      await assertStructuredOutputChangeAllowed(db, organizationId, request.params.id!, previous, structured.definition, input.acknowledgeStructuredOutputImpacts === true)
    }

    try {
      const outcome = await inTransaction(db, async (client) => {
        const updated = await client.query<{ id: string }>(
          `update assistant_orchestrators set
             name = coalesce($1, name),
             scope_type = $2,
             team_id = $3,
             subteam_id = $4,
             orchestrator_agent_id = coalesce($5, orchestrator_agent_id),
             active = coalesce($6, active),
             invocation_mode = coalesce($7, invocation_mode),
             output_instructions = case when $8::boolean then $9 else output_instructions end,
             output_schema = case when $10::boolean then $11::jsonb else output_schema end,
             policy_kind = $14,
             policy_domains = $15,
             routing_policy = $16,
             routing_domains = $17,
             structured_output = case when $18::boolean then $19::jsonb else structured_output end,
             recommend_support_materials = coalesce($20, recommend_support_materials),
             updated_at = now()
           where id = $12 and organization_id = $13
           returning id`,
          [
            input.name ?? null,
            nextScope.scopeType,
            nextScope.teamId,
            nextScope.subteamId,
            input.orchestratorAgentId ?? null,
            input.active ?? null,
            input.invocationMode ?? null,
            structured.outputInstructions !== undefined,
            structured.outputInstructions ?? null,
            structured.outputSchema !== undefined,
            structured.outputSchema ? JSON.stringify(structured.outputSchema) : null,
            request.params.id,
            organizationId,
            persisted.legacy.kind,
            persisted.legacyDomainCodes,
            persisted.routingPolicy,
            persisted.routingDomains,
            structured.touchesDefinition,
            structured.definition ? JSON.stringify(structured.definition) : null,
            input.recommendSupportMaterials ?? null,
          ],
        )
        if (!updated.rows[0]) {
          return "NOT_FOUND" as const
        }
        await syncOrchestratorBusinessDomains(client, request.params.id!, persisted.domainRefs)
        if (input.specialistAgentIds) {
          await syncSpecialists(client, request.params.id!, input.specialistAgentIds)
        }
        return "UPDATED" as const
      })
      if (outcome === "NOT_FOUND") return response.status(404).json(NOT_FOUND)
      const result = await db.query(`${ORCHESTRATOR_SELECT} and o.id = $2`, [organizationId, request.params.id])
      response.json({ data: decorateOrchestratorRow(result.rows[0]) })
    } catch (error) {
      rethrowFriendly(error)
    }
  })

  router.delete("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "agents.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    await db.query(`delete from assistant_orchestrators where id = $1 and organization_id = $2`, [request.params.id, organizationId])
    response.status(204).send()
  })

  return router
}
