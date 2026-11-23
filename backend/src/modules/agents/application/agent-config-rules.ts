import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canManageScope, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { resolveResourceScopeForWrite, scopedTargetOf, type ResourceScopeInput } from "../../org-structure/application/resource-scope-links.js"
import type { ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import { linkKey, sortLinks } from "../../../shared/domain/scope-links/scope-links.js"
import { assertBusinessDomainsSelectable, resolveBusinessDomainRefs } from "../../business-domains/application/business-domain-lookup.js"
import { normalizeCapabilities } from "../../investigation/domain/capabilities.js"
import { agentTeamIdsOf, knowledgeFitsAgentSql } from "../../knowledge/application/knowledge-agent-fit.js"
import { actionLimitsProblem, type AgentActionLimits } from "../domain/action-limits.js"
import { agentScopeFields, agentScopeOf, type AgentConfig } from "../domain/agent-config.js"
import { describeSpecialtyProblem, legacySpecialtyFor, resolveAgentSpecialty, type AgentSpecialty } from "../domain/agent-specialty.js"
import { loadAgentLifecycle, type AgentLifecycleRow } from "./agent-versions.js"

/**
 * REGRAS DE UMA CONFIGURAÇÃO DE AGENTE — as mesmas no cadastro (criar, editar, publicar, reverter) e na associação a partir da base
 * (`agent-knowledge-link-changes.ts`): alcance de quem age, especialidade pelo catálogo de domínios, limites de atuação, bases
 * existentes e que cabem no Grupo do agente, nome único. Saíram do router de agentes (run-8, ARQ-02) sem mudar comportamento.
 */

type Queryable = Pick<Database, "query">

export const agentNotFound = () => new DomainError("Agente não encontrado.", "AGENT_NOT_FOUND", 404)
export const agentScopeForbidden = () => new DomainError("Você não tem permissão para mover o agente para esse escopo.", "AGENT_SCOPE_FORBIDDEN", 403)

/** Nome repetido barrado pelo índice único (corrida entre duas gravações): o mesmo 409 da conferência prévia. */
export function rethrowNameTaken(error: unknown): never {
  if ((error as { code?: string }).code === "23505") throw new DomainError("Já existe um agente com esse nome.", "AGENT_NAME_TAKEN", 409)
  throw error
}

/** Ciclo de vida do agente com a linha travada até o fim da transação (toda escrita começa por aqui). */
export async function lifecycleForWrite(client: Queryable, organizationId: string, agentId: string): Promise<AgentLifecycleRow> {
  const lifecycle = await loadAgentLifecycle(client, organizationId, agentId, { forUpdate: true })
  if (!lifecycle) throw agentNotFound()
  return lifecycle
}

/**
 * Regra de LEITURA do módulo (administrar agentes no alcance) aplicada ao alcance de uma configuração. Rascunho e versões guardam o
 * PRÓPRIO alcance, que pode ser maior que o da linha viva: quem lê o agente pelo alcance da linha viva não lê, só por isso, o rascunho,
 * uma versão ou o conteúdo testado de outro alcance. Sem configuração (null) não há o que esconder.
 */
export function canReadAgentConfig(scopes: ManageableScopes, config: AgentScopeLike | null | undefined): boolean {
  return !config || canManageScope(scopes, scopedTargetOf(agentScopeOf(config)))
}

/**
 * Alcance em qualquer formato guardado: configuração (rascunho/versão, legado ou 249), alcance de configuração guardado no histórico
 * ou numa execução, ou `{ scopeType, links }`. Com vários vínculos, ler/agir exige TODOS no alcance de quem administra (`canManageScope`).
 */
export type AgentScopeLike = Parameters<typeof agentScopeOf>[0]

/**
 * Quem age sobre uma configuração — prévia das instruções, teste, prévia da publicação, publicar, reverter, salvar ou descartar o
 * rascunho — precisa alcançar também o alcance DELA, a mesma regra de mover o agente. Sem isso, quem administra um Grupo montava o
 * prompt (com as bases) de uma versão de todos os Grupos, a testava ou a publicava de novo.
 */
export function authorizeAgentConfig(scopes: ManageableScopes, config: AgentScopeLike | null | undefined): void {
  if (!canReadAgentConfig(scopes, config)) throw agentScopeForbidden()
}

/**
 * Mesma regra de `canManageScope` (vários vínculos: TODOS no alcance; "todos os Grupos" só com escopo de organização) no WHERE da lista
 * de agentes — total e páginas batem. `alias` é a linha com `id` e `"scopeType"` do agente; null = sem restrição.
 */
export function manageableAgentScopeSql(scopes: ManageableScopes, param: (value: unknown) => string, alias = "q"): string | null {
  if (scopes.unrestricted || scopes.allTeams) return null
  const teamIds = param([...scopes.teamIds])
  const subteamIds = param([...scopes.subteamIds])
  return `(${alias}."scopeType" = 'GROUPS'
    and exists (select 1 from agent_scope_links mas_l where mas_l.agent_id = ${alias}.id)
    and not exists (select 1 from agent_scope_links mas_l where mas_l.agent_id = ${alias}.id
                     and not ((mas_l.subteam_id is null and mas_l.team_id = any(${teamIds}::uuid[])) or (mas_l.subteam_id is not null and mas_l.subteam_id = any(${subteamIds}::uuid[])))))`
}

/** Texto vazio dos limites vira null (o interruptor desligado guarda o texto que houver). */
export const actionLimitsText = (value: string | null | undefined) => (value?.trim() ? value.trim() : null)

/** Ligado sem texto: 422 antes de gravar (o banco também recusa — agents_action_limits_check). */
export function assertActionLimits(limits: AgentActionLimits): void {
  const problem = actionLimitsProblem(limits)
  if (problem) throw new DomainError(problem, "AGENT_ACTION_LIMITS_REQUIRED", 422)
}

export type SpecialtyInput = { specialtyKind?: string | null | undefined; businessDomainId?: string | null | undefined; domain?: string | null | undefined; capability?: string | null | undefined; consolidatedInput?: boolean | undefined; specialty?: string | null | undefined }

/**
 * Entrada → especialidade tipada: a forma nova (`specialtyKind`…) prevalece; sem ela, a forma legada (`specialty`) é traduzida pelo
 * dual-read. `current` é o estado persistido (PATCH parcial). O domínio de negócio é SEMPRE resolvido contra o catálogo
 * (`business_domains`): por id, por código ou pelo código legado em `specialty`. Inexistente ⇒ 422 BUSINESS_DOMAIN_NOT_FOUND; inativo
 * só passa se for o domínio que o Agent já tinha.
 */
export async function specialtyFromInput(db: Queryable, organizationId: string, input: SpecialtyInput, current?: AgentSpecialty): Promise<AgentSpecialty | undefined> {
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
async function specialtyOfConfig(db: Queryable, config: AgentConfig): Promise<AgentSpecialty> {
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

/** Campos da especialidade como a configuração os guarda (forma nova + a legada derivada, dual-write). */
export function specialtyFields(specialty: AgentSpecialty): Pick<AgentConfig, "specialty" | "specialtyKind" | "domain" | "capability" | "consolidatedInput" | "businessDomainId"> {
  return { specialty: legacySpecialtyFor(specialty), specialtyKind: specialty.kind, domain: specialty.domain?.code ?? null, capability: specialty.capability, consolidatedInput: specialty.acceptsConsolidated, businessDomainId: specialty.domain?.id ?? null }
}

/**
 * Segurança de KB por código, não por confiança no id enviado pela tela: só bases da organização, não excluídas, e que cabem no Grupo
 * do agente (`knowledge-agent-fit.ts`), conferidas contra o alcance da CONFIGURAÇÃO (rascunho, ou versão a publicar).
 */
export async function assertKnowledge(client: Queryable, organizationId: string, config: AgentConfig): Promise<void> {
  const ids = [...new Set(config.knowledgeDocumentIds)]
  if (ids.length === 0) return
  const scope = agentScopeOf(config)
  const rows = (await client.query<{ id: string; fits: boolean }>(
    `select d.id, ${knowledgeFitsAgentSql("d.id", { scopeType: "$3::text", teamIds: "$4::uuid[]" })} fits
       from knowledge_documents d where d.id = any($1::uuid[]) and d.organization_id = $2 and d.deleted_at is null`,
    [ids, organizationId, scope.scopeType, agentTeamIdsOf(scope)],
  )).rows
  if (rows.length !== ids.length) throw new DomainError("Uma das bases de conhecimento selecionadas não existe ou foi excluída.", "AGENT_KNOWLEDGE_NOT_FOUND", 422)
  if (rows.some((row) => !row.fits)) throw new DomainError("Uma das bases de conhecimento selecionadas vale para outro Grupo — escolha bases globais ou de um dos Grupos deste agente.", "AGENT_KNOWLEDGE_SCOPE_FORBIDDEN", 422)
}

/** Outro agente da organização já usa o nome (a unicidade vale para a linha viva; conferida também no rascunho). */
export async function assertNameAvailable(client: Queryable, organizationId: string, name: string, agentId: string | null): Promise<void> {
  const taken = await client.query(`select 1 from agents where organization_id = $1 and name = $2 and ($3::uuid is null or id <> $3::uuid)`, [organizationId, name, agentId])
  if (taken.rows[0]) throw new DomainError("Já existe um agente com esse nome.", "AGENT_NAME_TAKEN", 409)
}

/** O que um pedido de edição pode mudar na configuração (campos ausentes ficam como estão). */
export type AgentConfigChanges = SpecialtyInput & {
  name?: string | undefined
  agentType?: AgentConfig["agentType"] | undefined
  objective?: string | undefined
  description?: string | undefined
  contextPrompt?: string | undefined
  /** Alcance (249): ALL_TEAMS ou GROUPS + `scopeLinks`; o legado TEAM/SUBTEAM + ids continua aceito e vira um vínculo. */
  scopeType?: ResourceScopeInput["scopeType"]
  teamId?: string | null | undefined
  subteamId?: string | null | undefined
  scopeLinks?: ResourceScopeInput["scopeLinks"]
  knowledgeDocumentIds?: string[] | undefined
  recommendSupportMaterials?: boolean | undefined
  investigationCapabilities?: string[] | undefined
  actionLimitsEnabled?: boolean | undefined
  actionLimits?: string | null | undefined
}

/**
 * O que a escrita do alcance preserva (249): vínculos já salvos — na versão vigente OU no rascunho — continuam aceitos mesmo sem operador
 * em produção ou depois de uma reclassificação; só os NOVOS passam pela admissão (universo do agente + operador em produção). "Todos"
 * já salvo (num dos dois) pode ser mantido.
 */
export function previousAgentScope(...scopes: (ResourceScope | null | undefined)[]): ResourceScope {
  const present = scopes.filter((scope): scope is ResourceScope => Boolean(scope))
  if (present.some((scope) => scope.scopeType === "ALL_TEAMS")) return { scopeType: "ALL_TEAMS", links: [] }
  const byKey = new Map(present.flatMap((scope) => scope.links).map((link) => [linkKey(link), link]))
  return { scopeType: "GROUPS", links: sortLinks([...byKey.values()]) }
}

/**
 * Alcance pedido numa escrita do agente, pronto para gravar: ALL_TEAMS só com escopo de organização (ou mantido); GROUPS com o Grupo-pai
 * real de cada Subgrupo, todos os vínculos no alcance de quem edita e os NOVOS do universo do agente e com operador em produção.
 */
export async function resolveAgentScopeForWrite(client: Queryable, organizationId: string, scopes: ManageableScopes, input: ResourceScopeInput, context: { previous: ResourceScope | null; universe: string | null }): Promise<ResourceScope> {
  return resolveResourceScopeForWrite(client, organizationId, scopes, input, {
    codePrefix: "AGENT",
    previous: context.previous,
    universe: context.universe,
    allTeamsMessage: "Só quem administra agentes da organização inteira escolhe “Todos os Grupos e Subgrupos”.",
  })
}

/** Configuração seguinte = a editável + o que veio no pedido, validada como um cadastro inteiro (inclusive o alcance resultante). */
export async function nextConfig(
  client: Queryable,
  organizationId: string,
  scopes: ManageableScopes,
  base: AgentConfig,
  input: AgentConfigChanges,
  /** Para mudar o alcance: o que já estava salvo (vigente + rascunho) e o universo do agente. Sem ele, só o alcance de `base` é preservado. */
  scopeContext: { previous: ResourceScope | null; universe: string | null } = { previous: agentScopeOf(base), universe: null },
): Promise<AgentConfig> {
  let scope = agentScopeOf(base)
  if (input.scopeType !== undefined) {
    scope = await resolveAgentScopeForWrite(client, organizationId, scopes, { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null, scopeLinks: input.scopeLinks ?? [] }, scopeContext)
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
    ...agentScopeFields(scope),
    ...(specialty ? specialtyFields(specialty) : {}),
    recommendSupportMaterials: input.recommendSupportMaterials ?? base.recommendSupportMaterials,
    investigationCapabilities: input.investigationCapabilities ? normalizeCapabilities(input.investigationCapabilities) : base.investigationCapabilities,
    actionLimitsEnabled: actionLimits.enabled,
    actionLimits: actionLimits.text,
    knowledgeDocumentIds: input.knowledgeDocumentIds ? [...new Set(input.knowledgeDocumentIds)].sort() : base.knowledgeDocumentIds,
  }
  await assertKnowledge(client, organizationId, config)
  return config
}
