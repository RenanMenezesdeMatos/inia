import { randomUUID } from "node:crypto"
import { Router, type NextFunction, type Request, type Response } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canAnywhere, canOnCollaborator, canOrganizationWide, scopesWithPermission, type AccessContext } from "../../access/domain/access-decision.js"
import { scopeCovers, type AccessScope } from "../../access/domain/access-scope.js"
import type { Permission } from "../../access/domain/permissions.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { createReadOnlyDatabase } from "../../qa-lab/application/read-only-database.js"
import { buildIntelligenceReport } from "../domain/intelligence-report.js"
import { policyDefinitionSchema, validatePolicyDefinition } from "../domain/policy-definition.js"
import { CAPABILITY_DEFINITIONS, EVIDENCE_KIND_LABELS, INTERVENTION_CAPABILITIES } from "../domain/capabilities.js"
import { applyEvaluation } from "../application/apply-evaluation.js"
import { loadPolicyHeader, loadPolicyVersion, loadValidationCatalog, type PolicyHeader, type PolicyVersion } from "../application/catalog.js"
import * as config from "../application/config-service.js"
import { evaluatePolicy, serializeEvaluation } from "../application/evaluate-policy.js"
import { canSeeInterventionsOf } from "../application/intervention-access.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Administração das políticas de acompanhamento — `/api/v1/admin/intervention-policies`. Permissões SEPARADAS: editar,
 * simular, publicar, auditar (catálogo da organização inteira — tipos e competências — só com escopo de organização; políticas
 * pelo escopo dela). Simular com uma pessoa real exige também ENXERGÁ-LA (estrutura própria, Indicadores ou Workflows no
 * escopo): configurar não dá acesso a colaborador nenhum. A simulação roda sobre um banco SOMENTE LEITURA (nada é gravado).
 */
const POLICY_PERMISSIONS: Permission[] = ["intervention_policies.edit", "intervention_policies.simulate", "intervention_policies.publish", "intervention_policies.audit"]

declare module "express-serve-static-core" {
  interface Request {
    interventionAccess?: AccessContext
  }
}

const forbidden = (message = "Você não tem permissão para este recurso.") => new DomainError(message, "FORBIDDEN", 403)
const actorOf = (request: Request) => ({ userAccountId: sessionUser(request).sub, personId: sessionUser(request).personId })
const accessOf = (request: Request) => request.interventionAccess!

const policyScopeOf = (policy: Pick<PolicyHeader, "scopeType" | "teamId" | "subteamId">): AccessScope =>
  policy.scopeType === "ORGANIZATION" ? { type: "ORGANIZATION" } : policy.scopeType === "GROUP" ? { type: "GROUP", teamId: policy.teamId! } : { type: "SUBGROUP", teamId: policy.teamId!, subteamId: policy.subteamId! }

/** Escrita numa política: o escopo da permissão COBRE o da política. */
const coversPolicy = (access: AccessContext, permission: Permission, policy: Pick<PolicyHeader, "scopeType" | "teamId" | "subteamId">) => scopesWithPermission(access, permission).some((scope) => scopeCovers(scope, policyScopeOf(policy)))
/** Leitura: o escopo da permissão cobre a política ou é coberto por ela (uma política da organização vale para todos). */
const seesPolicy = (access: AccessContext, policy: Pick<PolicyHeader, "scopeType" | "teamId" | "subteamId">) =>
  [...POLICY_PERMISSIONS, "workflows.manage" as Permission].some((permission) => scopesWithPermission(access, permission).some((scope) => scopeCovers(scope, policyScopeOf(policy)) || scopeCovers(policyScopeOf(policy), scope)))

function requireAny(permissions: Permission[]) {
  return (request: Request, _response: Response, next: NextFunction) => (permissions.some((permission) => canAnywhere(accessOf(request), permission)) ? next() : next(forbidden()))
}
function requireOrganizationWide(permission: Permission) {
  return (request: Request, _response: Response, next: NextFunction) => (canOrganizationWide(accessOf(request), permission) ? next() : next(new DomainError("O catálogo vale para a organização inteira: só quem tem esta permissão em toda a organização pode alterá-lo.", "ORGANIZATION_SCOPE_REQUIRED", 403)))
}

async function policyForWrite(db: Database, request: Request, permission: Permission): Promise<PolicyHeader> {
  const policy = await config.loadPolicyOrThrow(db, sessionUser(request).organizationId, String(request.params.policyId))
  if (!seesPolicy(accessOf(request), policy)) throw new DomainError("Política não encontrada.", "INTERVENTION_POLICY_NOT_FOUND", 404)
  if (!coversPolicy(accessOf(request), permission, policy)) throw forbidden("Seu escopo não cobre o escopo desta política.")
  return policy
}

async function policyForRead(db: Database, request: Request): Promise<PolicyHeader> {
  const policy = await config.loadPolicyOrThrow(db, sessionUser(request).organizationId, String(request.params.policyId))
  if (!seesPolicy(accessOf(request), policy)) throw new DomainError("Política não encontrada.", "INTERVENTION_POLICY_NOT_FOUND", 404)
  return policy
}

/**
 * Pode simular com ESTA pessoa? Precisa enxergá-la por outra concessão: própria estrutura ou Indicadores no escopo
 * (`loadViewerScope`), ou Workflows no escopo (o mesmo critério do "Executar agora"). Fora disso = 404 (nunca revela).
 */
async function canSimulateWith(db: Database, request: Request, personId: string): Promise<boolean> {
  if (personId === sessionUser(request).personId) return false
  const access = accessOf(request)
  const repository = createPostgresAccessRepository(db)
  const collaborator = await repository.collaborator(access.organizationId, personId)
  if (!collaborator) return false
  if (canOnCollaborator(access, "workflows.manage", collaborator, await repository.isInStructure(access.organizationId, access.personId, personId))) return true
  const scope = await loadViewerScope(new PgAnalyticsReadRepository(db), sessionUser(request), "indicators.view")
  return scope.nodes.has(personId)
}

const simulateSchema = z
  .object({
    personId: z.string().uuid(),
    /** Instante de referência (período analisado termina aqui). Ausente = agora. */
    asOf: z.string().datetime({ offset: true }).nullable().default(null),
    /** DRAFT = o rascunho atual; IN_FORCE = a versão em vigor no instante; ou o id de uma versão publicada. */
    version: z.union([z.literal("DRAFT"), z.literal("IN_FORCE"), z.string().uuid()]).default("IN_FORCE"),
    mode: z.enum(["RECOMMEND_ONLY", "APPLY_POLICY"]).default("APPLY_POLICY"),
  })
  .strict()

export function createInterventionAdminRouter(db: Database) {
  const router = Router()
  router.use(async (request, _response, next) => {
    try {
      request.interventionAccess = await createPostgresAccessRepository(db).loadContext(sessionUser(request).organizationId, sessionUser(request).sub)
      if (![...POLICY_PERMISSIONS, "workflows.manage" as Permission].some((permission) => canAnywhere(request.interventionAccess!, permission))) return next(forbidden())
      return next()
    } catch (error) {
      return next(error)
    }
  })
  const organizationOf = (request: Request) => sessionUser(request).organizationId
  const anyPolicyPermission = requireAny(POLICY_PERMISSIONS)

  // Catálogo técnico (fixo em código): o que o editor precisa para montar tipos e políticas.
  router.get("/capabilities", (_request, response) => {
    response.json({ data: { capabilities: INTERVENTION_CAPABILITIES.map((key) => ({ key, ...CAPABILITY_DEFINITIONS[key] })), evidenceKinds: Object.entries(EVIDENCE_KIND_LABELS).map(([key, label]) => ({ key, label })) } })
  })

  // Grupos (do escopo de quem edita), indicadores e documentos para os seletores do editor — sem exigir as permissões das telas
  // de estrutura, indicadores ou base de conhecimento. Sem permissão de editar, os grupos são os do escopo de leitura.
  router.get("/editor-catalog", async (request, response) => {
    const access = accessOf(request)
    const editScopes = scopesWithPermission(access, "intervention_policies.edit")
    const scopes = editScopes.length > 0 ? editScopes : [...POLICY_PERMISSIONS, "workflows.manage" as Permission].flatMap((permission) => scopesWithPermission(access, permission))
    const teamIds = new Set<string>()
    const subteamIds = new Set<string>()
    for (const scope of scopes) {
      if (scope.type === "GROUP") teamIds.add(scope.teamId)
      if (scope.type === "SUBGROUP") subteamIds.add(scope.subteamId)
    }
    const unrestricted = scopes.some((scope) => scope.type === "ORGANIZATION")
    response.json({ data: await config.loadEditorCatalog(db, organizationOf(request), { unrestricted, teamIds, subteamIds }) })
  })

  // Práticas e critérios da base pelo NOME (para ligar a competência ao diagnóstico sem digitar chaves técnicas).
  router.get("/editor-catalog/patterns", async (request, response) => {
    const query = z.object({ search: z.string().max(120).optional(), keys: z.string().max(4000).optional() }).parse(request.query)
    response.json({ data: await config.searchPatternOptions(db, organizationOf(request), { ...(query.search ? { search: query.search } : {}), keys: query.keys ? query.keys.split(",").map((key) => key.trim()) : [] }) })
  })

  // ---- TIPOS -------------------------------------------------------------------------------------------------------------
  router.get("/types", async (request, response) => response.json({ data: await config.listInterventionTypes(db, organizationOf(request)) }))
  router.get("/types/:typeId", async (request, response) => response.json({ data: await config.getInterventionType(db, organizationOf(request), String(request.params.typeId)) }))
  router.post("/types", requireOrganizationWide("intervention_policies.edit"), async (request, response) => response.status(201).json({ data: await config.createInterventionType(db, organizationOf(request), actorOf(request), request.body ?? {}) }))
  router.put("/types/:typeId/draft", requireOrganizationWide("intervention_policies.edit"), async (request, response) => response.json({ data: await config.saveInterventionTypeDraft(db, organizationOf(request), actorOf(request), String(request.params.typeId), request.body?.definition) }))
  router.post("/types/:typeId/validate", anyPolicyPermission, async (request, response) => {
    const issues = await config.validateInterventionTypeDraft(db, organizationOf(request), String(request.params.typeId))
    response.json({ data: { valid: issues.length === 0, issues } })
  })
  router.post("/types/:typeId/publish", requireOrganizationWide("intervention_policies.publish"), async (request, response) => response.json({ data: await config.publishInterventionTypeDraft(db, organizationOf(request), actorOf(request), String(request.params.typeId)) }))
  router.delete("/types/:typeId/draft", requireOrganizationWide("intervention_policies.edit"), async (request, response) => response.json({ data: await config.discardInterventionTypeDraft(db, organizationOf(request), actorOf(request), String(request.params.typeId)) }))
  router.post("/types/:typeId/active", requireOrganizationWide("intervention_policies.publish"), async (request, response) => response.json({ data: await config.setInterventionTypeActive(db, organizationOf(request), actorOf(request), String(request.params.typeId), z.object({ active: z.boolean() }).parse(request.body).active) }))

  // ---- COMPETÊNCIAS ------------------------------------------------------------------------------------------------------
  router.get("/competencies", async (request, response) => response.json({ data: await config.listCompetencies(db, organizationOf(request)) }))
  router.post("/competencies", requireOrganizationWide("intervention_policies.edit"), async (request, response) => response.status(201).json({ data: await config.createCompetency(db, organizationOf(request), actorOf(request), request.body) }))
  router.put("/competencies/:competencyId", requireOrganizationWide("intervention_policies.edit"), async (request, response) => response.json({ data: await config.updateCompetency(db, organizationOf(request), actorOf(request), String(request.params.competencyId), request.body) }))
  router.post("/competencies/:competencyId/active", requireOrganizationWide("intervention_policies.edit"), async (request, response) => response.json({ data: await config.setCompetencyActive(db, organizationOf(request), actorOf(request), String(request.params.competencyId), z.object({ active: z.boolean() }).parse(request.body).active) }))

  // ---- POLÍTICAS ---------------------------------------------------------------------------------------------------------
  router.get("/policies", async (request, response) => {
    const policies = (await config.listPolicies(db, organizationOf(request))).filter((policy) => seesPolicy(accessOf(request), policy))
    response.json({ data: policies.map((policy) => ({ ...policy, can: { edit: coversPolicy(accessOf(request), "intervention_policies.edit", policy), publish: coversPolicy(accessOf(request), "intervention_policies.publish", policy), simulate: canAnywhere(accessOf(request), "intervention_policies.simulate") || canAnywhere(accessOf(request), "workflows.manage") } })) })
  })
  /**
   * Resumo das políticas PUBLICADAS para o nó do Workflow (seleção, prévia de tipos, responsáveis e aprovações). Lê-se com
   * `workflows.manage` também — é o que o editor de Workflow precisa, sem dar acesso de edição da política.
   */
  router.get("/published-summary", async (request, response) => {
    const [policies, types] = await Promise.all([config.listPolicies(db, organizationOf(request)), config.listInterventionTypes(db, organizationOf(request))])
    const typeByKey = new Map(types.map((type) => [type.key, type]))
    response.json({
      data: policies
        .filter((policy) => seesPolicy(accessOf(request), policy) && policy.versions.some((version) => version.status === "PUBLISHED"))
        .map((policy) => {
          const version = policy.inForce ?? policy.scheduled[0] ?? null
          const actionKeys = [...new Set(version?.definition.rules.flatMap((rule) => [...rule.actions, ...rule.inconclusiveActions].map((action) => action.typeKey)) ?? [])]
          return {
            id: policy.id,
            key: policy.key,
            name: policy.name,
            active: policy.active,
            scopeLabel: policy.scopeLabel,
            inForceVersion: policy.inForce?.version ?? null,
            scheduledVersions: policy.scheduled.map((item) => ({ version: item.version, effectiveFrom: item.effectiveFrom })),
            description: version?.definition.description ?? "",
            indicatorCode: version?.definition.indicatorCode ?? null,
            matchStrategy: version?.definition.matchStrategy ?? null,
            rules: version?.definition.rules.map((rule) => ({ key: rule.key, name: rule.name, priority: rule.priority, actions: rule.actions.map((action) => ({ typeKey: action.typeKey, effect: action.effect })), inconclusiveActions: rule.inconclusiveActions.map((action) => ({ typeKey: action.typeKey, effect: action.effect })) })) ?? [],
            types: actionKeys.map((key) => {
              const definition = typeByKey.get(key)?.published?.definition
              return { key, name: definition?.name ?? key, responsibleRole: definition?.responsibleRole ?? null, approval: definition?.approval ?? null, sensitive: definition?.capabilities.includes("CONTINUITY_REVIEW") ?? false, active: typeByKey.get(key)?.active ?? false }
            }),
          }
        }),
    })
  })
  router.get("/policies/:policyId", async (request, response) => {
    const policy = await policyForRead(db, request)
    const view = await config.getPolicy(db, organizationOf(request), policy.id)
    response.json({ data: { ...view, can: { edit: coversPolicy(accessOf(request), "intervention_policies.edit", policy), publish: coversPolicy(accessOf(request), "intervention_policies.publish", policy), simulate: canAnywhere(accessOf(request), "intervention_policies.simulate") || canAnywhere(accessOf(request), "workflows.manage"), audit: canAnywhere(accessOf(request), "intervention_policies.audit") } } })
  })
  router.post("/policies", requireAny(["intervention_policies.edit"]), async (request, response) => {
    const body = z.object({ key: z.string(), name: z.string(), scopeType: z.enum(["ORGANIZATION", "GROUP", "SUBGROUP"]), teamId: z.string().uuid().nullable().default(null), subteamId: z.string().uuid().nullable().default(null) }).parse(request.body)
    if (!coversPolicy(accessOf(request), "intervention_policies.edit", body)) throw forbidden("Seu escopo não cobre o escopo escolhido para a política.")
    response.status(201).json({ data: await config.createPolicy(db, organizationOf(request), actorOf(request), body) })
  })
  router.patch("/policies/:policyId", async (request, response) => {
    const policy = await policyForWrite(db, request, "intervention_policies.edit")
    const body = z.object({ name: z.string().optional(), scopeType: z.enum(["ORGANIZATION", "GROUP", "SUBGROUP"]).optional(), teamId: z.string().uuid().nullable().optional(), subteamId: z.string().uuid().nullable().optional() }).parse(request.body ?? {})
    if (body.scopeType && !coversPolicy(accessOf(request), "intervention_policies.edit", { scopeType: body.scopeType, teamId: body.teamId ?? null, subteamId: body.subteamId ?? null })) throw forbidden("Seu escopo não cobre o novo escopo.")
    response.json({ data: await config.updatePolicyHeader(db, organizationOf(request), actorOf(request), policy.id, body) })
  })
  router.put("/policies/:policyId/draft", async (request, response) => {
    const policy = await policyForWrite(db, request, "intervention_policies.edit")
    response.json({ data: await config.savePolicyDraft(db, organizationOf(request), actorOf(request), policy.id, request.body?.definition) })
  })
  router.post("/policies/:policyId/validate", anyPolicyPermission, async (request, response) => {
    const policy = await policyForRead(db, request)
    const issues = await config.validatePolicyDraft(db, organizationOf(request), policy.id)
    response.json({ data: { valid: issues.length === 0, issues } })
  })
  router.post("/policies/:policyId/publish", async (request, response) => {
    const policy = await policyForWrite(db, request, "intervention_policies.publish")
    const body = z.object({ effectiveFrom: z.string().datetime({ offset: true }).nullable().optional() }).parse(request.body ?? {})
    response.json({ data: await config.publishPolicyDraft(db, organizationOf(request), actorOf(request), policy.id, { effectiveFrom: body.effectiveFrom ?? null }) })
  })
  router.delete("/policies/:policyId/draft", async (request, response) => {
    const policy = await policyForWrite(db, request, "intervention_policies.edit")
    response.json({ data: await config.discardPolicyDraft(db, organizationOf(request), actorOf(request), policy.id) })
  })
  router.post("/policies/:policyId/active", async (request, response) => {
    const policy = await policyForWrite(db, request, "intervention_policies.publish")
    response.json({ data: await config.setPolicyActive(db, organizationOf(request), actorOf(request), policy.id, z.object({ active: z.boolean() }).parse(request.body).active) })
  })

  // ---- SIMULAÇÃO (sem efeito) --------------------------------------------------------------------------------------------
  router.get("/simulation-people", requireAny(["intervention_policies.simulate", "workflows.manage"]), async (request, response) => {
    const search = typeof request.query.search === "string" ? request.query.search.trim() : ""
    const candidates = (await db.query<{ id: string; name: string; team_name: string | null }>(
      `select p.id, p.name, t.name team_name from people p left join teams t on t.id = p.team_id where p.organization_id = $1 and p.active and p.role = 'OPERATOR' and ($2 = '' or p.name ilike '%' || $2 || '%') order by p.name limit 40`,
      [organizationOf(request), search],
    )).rows
    const visible = []
    for (const candidate of candidates) if (visible.length < 15 && (await canSimulateWith(db, request, candidate.id))) visible.push({ id: candidate.id, name: candidate.name, teamName: candidate.team_name })
    response.json({ data: visible })
  })
  router.post("/policies/:policyId/simulate", requireAny(["intervention_policies.simulate", "workflows.manage"]), async (request, response) => {
    const policy = await policyForRead(db, request)
    const body = simulateSchema.parse(request.body ?? {})
    if (!(await canSimulateWith(db, request, body.personId))) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
    const readOnly = createReadOnlyDatabase(db)
    const asOf = body.asOf ? new Date(body.asOf) : new Date()
    const view = await config.getPolicy(readOnly, organizationOf(request), policy.id)
    let version: PolicyVersion | null | undefined
    let draftIssues: { path: string; code: string; message: string }[] = []
    if (body.version === "DRAFT") {
      if (!view.draft) throw new DomainError("Não há rascunho para simular.", "INTERVENTION_POLICY_DRAFT_NOT_FOUND", 409)
      const parsed = policyDefinitionSchema.safeParse(view.draft.definition)
      if (!parsed.success) throw new DomainError("O rascunho tem campos inválidos: salve-o de novo antes de simular.", "INTERVENTION_POLICY_INVALID", 422)
      draftIssues = validatePolicyDefinition(parsed.data, await loadValidationCatalog(readOnly, organizationOf(request)))
      version = { id: view.draft.id, version: view.draft.version, effectiveFrom: asOf.toISOString(), definition: parsed.data }
    } else if (body.version !== "IN_FORCE") {
      version = await loadPolicyVersion(readOnly, organizationOf(request), body.version)
      if (!version || (version as { policyId?: string }).policyId !== policy.id) throw new DomainError("Versão não encontrada.", "INTERVENTION_POLICY_VERSION_NOT_FOUND", 404)
    }
    // Simulação: inativa também é simulável (é assim que se testa antes de reativar).
    // Simular com uma pessoa não abre as intervenções dela: sem esse acesso, o histórico de intervenções não é lido (SCOPE-02).
    const interventionHistory = (await canSeeInterventionsOf(db, accessOf(request), body.personId)) ? "VISIBLE" : "HIDDEN"
    const evaluation = await evaluatePolicy(readOnly, { organizationId: organizationOf(request), policy: { ...policy, active: true }, personId: body.personId, asOf, recommendOnly: body.mode === "RECOMMEND_ONLY", interventionHistory, ...(version !== undefined ? { version } : {}) })
    if (!evaluation) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
    const report = evaluation.decisions.length > 0 && evaluation.version
      ? buildIntelligenceReport({
          asOf,
          subject: { personId: evaluation.person.id, personName: evaluation.person.name, teamName: evaluation.person.teamName, indicatorCode: evaluation.indicatorCode, indicatorName: evaluation.indicatorName },
          policy: { id: policy.id, key: policy.key, name: policy.name, version: evaluation.version.version, versionId: evaluation.version.id, effectiveFrom: evaluation.version.effectiveFrom, matchStrategy: evaluation.version.definition.matchStrategy },
          definition: evaluation.version.definition,
          rules: evaluation.rules,
          selection: evaluation.selection,
          decisions: evaluation.decisions,
          outcome: evaluation.outcome,
          types: evaluation.types,
          assignments: new Map([...evaluation.assignments].map(([key, value]) => [key, { responsible: value.responsible, approver: value.approver, dueAt: value.dueAt }])),
          interventionIds: new Map(),
          priorInterventions: evaluation.priorInterventions,
          diagnoses: evaluation.diagnoses,
          extraSources: [],
        })
      : null
    response.json({ data: { simulated: true, effects: "NONE", draftIssues, evaluation: serializeEvaluation(evaluation), report } })
  })

  // ---- AUDITORIA ---------------------------------------------------------------------------------------------------------
  router.get("/audit", requireAny(["intervention_policies.audit"]), async (request, response) => {
    const entityId = typeof request.query.entityId === "string" && /^[0-9a-f-]{36}$/i.test(request.query.entityId) ? request.query.entityId : null
    const rows = await db.query<{ id: string; action: string; entity_type: string; entity_id: string; payload: unknown; created_at: Date; actor_name: string | null }>(
      `select a.id, a.action, a.entity_type, a.entity_id, a.payload, a.created_at, p.name actor_name from audit_logs a left join people p on p.id = a.actor_id
        where a.organization_id = $1 and a.entity_type in ('intervention_type','intervention_policy','competency') and ($2::uuid is null or a.entity_id = $2) order by a.created_at desc limit 200`,
      [organizationOf(request), entityId],
    )
    response.json({ data: rows.rows.map((row) => ({ id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, payload: row.payload, createdAt: row.created_at.toISOString(), actorName: row.actor_name })) })
  })
  router.get("/policies/:policyId/evaluations", requireAny(["intervention_policies.audit"]), async (request, response) => {
    const policy = await policyForRead(db, request)
    const rows = (await db.query<{ id: string; person_id: string; person_name: string; origin: string; outcome: string; evaluated_at: Date; version: number | null; supersedes: string | null }>(
      `select ev.id, ev.person_id, p.name person_name, ev.origin, ev.outcome, ev.evaluated_at, v.version, ev.supersedes_evaluation_id supersedes from intervention_policy_evaluations ev
         join people p on p.id = ev.person_id left join intervention_policy_versions v on v.id = ev.policy_version_id
        where ev.organization_id = $1 and ev.policy_id = $2 order by ev.evaluated_at desc limit 200`,
      [organizationOf(request), policy.id],
    )).rows
    // Auditar a configuração não abre o colaborador: nome só de quem o viewer já enxerga.
    const visible = new Map<string, boolean>()
    for (const row of rows) if (!visible.has(row.person_id)) visible.set(row.person_id, await canSimulateWith(db, request, row.person_id))
    response.json({ data: rows.map((row) => ({ id: row.id, person: visible.get(row.person_id) ? { id: row.person_id, name: row.person_name } : null, origin: row.origin, outcome: row.outcome, evaluatedAt: row.evaluated_at.toISOString(), policyVersion: row.version, supersedesEvaluationId: row.supersedes })) })
  })
  router.get("/evaluations/:evaluationId", requireAny(["intervention_policies.audit"]), async (request, response) => {
    const id = String(request.params.evaluationId)
    const row = /^[0-9a-f-]{36}$/i.test(id) ? (await db.query<Record<string, unknown> & { person_id: string; policy_id: string }>(`select * from intervention_policy_evaluations where id = $1 and organization_id = $2`, [id, organizationOf(request)])).rows[0] : undefined
    if (!row) throw new DomainError("Avaliação não encontrada.", "INTERVENTION_EVALUATION_NOT_FOUND", 404)
    const policy = await loadPolicyHeader(db, organizationOf(request), row.policy_id)
    // A avaliação gravada decidiu intervenções reais (fatos, decisões e justificativa citam as anteriores): só quem as vê (SCOPE-02).
    if (!policy || !seesPolicy(accessOf(request), policy) || !(await canSimulateWith(db, request, row.person_id)) || !(await canSeeInterventionsOf(db, accessOf(request), row.person_id))) throw new DomainError("Avaliação não encontrada.", "INTERVENTION_EVALUATION_NOT_FOUND", 404)
    response.json({ data: row })
  })
  /**
   * REAVALIAÇÃO (correção tardia de dados): mesma versão FIXADA e mesmo instante de referência da avaliação original, fatos
   * lidos de novo. Gera um registro NOVO ligado ao original (nunca reescreve); nenhuma intervenção é aberta ou alterada —
   * as relacionadas recebem o evento com o novo resultado, para quem as conduz decidir.
   */
  router.post("/evaluations/:evaluationId/reevaluate", requireAny(["intervention_policies.audit", "interventions.execute"]), async (request, response) => {
    const id = String(request.params.evaluationId)
    const reason = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(request.body ?? {}).reason
    const original = /^[0-9a-f-]{36}$/i.test(id) ? (await db.query<{ id: string; policy_id: string; policy_version_id: string | null; person_id: string; as_of: Date; facts: { recommendOnly?: boolean } }>(`select id, policy_id, policy_version_id, person_id, as_of, facts from intervention_policy_evaluations where id = $1 and organization_id = $2`, [id, organizationOf(request)])).rows[0] : undefined
    if (!original) throw new DomainError("Avaliação não encontrada.", "INTERVENTION_EVALUATION_NOT_FOUND", 404)
    const policy = await loadPolicyHeader(db, organizationOf(request), original.policy_id)
    // Reavaliar grava o resultado nas intervenções relacionadas: só quem as vê (SCOPE-02).
    if (!policy || !seesPolicy(accessOf(request), policy) || !(await canSimulateWith(db, request, original.person_id)) || !(await canSeeInterventionsOf(db, accessOf(request), original.person_id))) throw new DomainError("Avaliação não encontrada.", "INTERVENTION_EVALUATION_NOT_FOUND", 404)
    const version = original.policy_version_id ? await loadPolicyVersion(db, organizationOf(request), original.policy_version_id) : null
    const evaluation = await evaluatePolicy(db, { organizationId: organizationOf(request), policy: { ...policy, active: true }, personId: original.person_id, asOf: original.as_of, recommendOnly: Boolean(original.facts?.recommendOnly), version })
    if (!evaluation) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
    const result = await applyEvaluation(db, { evaluation, origin: "REEVALUATION", idempotencyKey: `reeval:${original.id}:${randomUUID()}`, requestedBy: sessionUser(request).personId, supersedesEvaluationId: original.id, reevaluationReason: reason, applyDecisions: false })
    response.status(201).json({ data: result })
  })

  return router
}
