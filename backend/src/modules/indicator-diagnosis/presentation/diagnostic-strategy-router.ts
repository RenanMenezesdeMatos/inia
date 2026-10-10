import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canManageScope, coversOrganization, getManageableScopes, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { periodLabelOf } from "../../indicators/domain/indicator-canonical-context.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { discardStrategyDraft, loadStrategyOverview, publishStrategyDraft, saveStrategyDraft, setStrategyActive, type StrategyActor } from "../application/diagnostic-strategy-service.js"
import { simulateDiagnosticStrategy } from "../application/simulate-diagnostic-strategy.js"

/**
 * V1.6.2 — /api/v1/admin/indicator-diagnostic-strategies (montado com `configuration.manage`, a mesma permissão da tela de
 * Indicadores). Organização SEMPRE da sessão. Estratégia é configuração do tenant: ler exige a permissão em algum escopo;
 * ALTERAR (rascunho, publicar, descartar, ativar) exige a permissão na organização inteira. A simulação só aceita colaborador
 * dentro do escopo da permissão (fora dele = 404, sem distinguir) — nenhum dado de fora do escopo vaza por ela.
 */
const draftBodySchema = z.object({ config: z.unknown().optional() })
const activeBodySchema = z.object({ active: z.boolean() })
const simulateBodySchema = z.object({ source: z.enum(["DRAFT", "PUBLISHED"]), collaboratorId: z.string().uuid(), measurementId: z.string().uuid(), agentId: z.string().uuid(), aiPolicy: z.enum(["REAL", "STOP_BEFORE_AI"]).default("STOP_BEFORE_AI") })
const subjectsQuerySchema = z.object({ search: z.string().trim().max(80).optional() })
const SIMULATION_MAX_COLLABORATORS = 30
const SIMULATION_MEASUREMENTS_PER_PERSON = 6
const SIMULATION_RECENT_MEASUREMENTS = 90

export function createDiagnosticStrategyRouter(db: Database) {
  const router = Router()
  const session = (request: Request) => {
    const user = request.user!
    return { organizationId: user.organizationId, actor: { userAccountId: user.sub, personId: user.personId } satisfies StrategyActor, user }
  }
  const scopesOf = (request: Request) => getManageableScopes(db, request.user!, "configuration.manage")
  const requireOrganizationWide = async (request: Request) => {
    if (!coversOrganization(await scopesOf(request))) throw new DomainError("Alterar a estratégia de diagnóstico exige a administração de indicadores na organização inteira.", "FORBIDDEN", 403)
  }
  const personInScope = async (organizationId: string, scopes: ManageableScopes, personId: string) => {
    const person = (await db.query<{ team_id: string | null; subteam_id: string | null }>(`select team_id, subteam_id from people where id = $1 and organization_id = $2 and active`, [personId, organizationId])).rows[0]
    if (!person) return false
    return canManageScope(scopes, person.subteam_id ? { scopeType: "SUBTEAM", teamId: person.team_id, subteamId: person.subteam_id } : { scopeType: "TEAM", teamId: person.team_id, subteamId: null })
  }

  router.get("/indicators/:indicatorId", async (request, response) => {
    const { organizationId } = session(request)
    response.json({ data: await loadStrategyOverview(db, organizationId, request.params.indicatorId) })
  })

  router.put("/indicators/:indicatorId/draft", async (request, response) => {
    await requireOrganizationWide(request)
    const { organizationId, actor } = session(request)
    response.json({ data: await saveStrategyDraft(db, organizationId, request.params.indicatorId, draftBodySchema.parse(request.body ?? {}), actor) })
  })

  router.post("/indicators/:indicatorId/publish", async (request, response) => {
    await requireOrganizationWide(request)
    const { organizationId, actor } = session(request)
    response.json({ data: await publishStrategyDraft(db, organizationId, request.params.indicatorId, actor) })
  })

  router.delete("/indicators/:indicatorId/draft", async (request, response) => {
    await requireOrganizationWide(request)
    const { organizationId, actor } = session(request)
    response.json({ data: await discardStrategyDraft(db, organizationId, request.params.indicatorId, actor) })
  })

  router.post("/indicators/:indicatorId/active", async (request, response) => {
    await requireOrganizationWide(request)
    const { organizationId, actor } = session(request)
    response.json({ data: await setStrategyActive(db, organizationId, request.params.indicatorId, activeBodySchema.parse(request.body).active, actor) })
  })

  /**
   * Quem pode ser usado no teste: colaboradores DO ESCOPO com medição deste indicador (busca por nome) e os Agents ativos.
   * As PESSOAS são escolhidas antes das medições — cortar linhas de medição deixava só as primeiras pessoas do alfabeto
   * (cada uma tem uma medição por dia). Por pessoa, até 6 períodos recentes, primeiro os que têm atendimento na janela
   * da medição (a mesma do plano): um período sem atendimento sempre termina em "Nenhum atendimento".
   */
  router.get("/indicators/:indicatorId/simulation-options", async (request, response) => {
    const { organizationId } = session(request)
    const indicator = (await db.query(`select 1 from indicator_definitions where id = $1 and organization_id = $2`, [request.params.indicatorId, organizationId])).rows[0]
    if (!indicator) throw new DomainError("Indicador não encontrado.", "INDICATOR_NOT_FOUND", 404)
    const scopes = await scopesOf(request)
    const query = subjectsQuerySchema.parse(request.query)
    const timeZone = await resolveOrganizationTimezone(db, organizationId)
    const candidates = (await db.query<{ person_id: string; name: string; team_id: string | null; subteam_id: string | null }>(
      `select p.id person_id, p.name, p.team_id, p.subteam_id
       from people p
       where p.organization_id = $1 and p.active and ($3::text is null or p.name ilike '%' || $3 || '%')
         and exists (select 1 from indicator_measurements m where m.organization_id = $1 and m.indicator_definition_id = $2 and m.subject_type = 'PERSON' and m.subject_id = p.id)
       order by p.name limit 500`,
      [organizationId, request.params.indicatorId, query.search || null],
    )).rows
    const inScope = candidates
      .filter((row) => canManageScope(scopes, row.subteam_id ? { scopeType: "SUBTEAM", teamId: row.team_id, subteamId: row.subteam_id } : { scopeType: "TEAM", teamId: row.team_id, subteamId: null }))
      .slice(0, SIMULATION_MAX_COLLABORATORS)
    const measurements = inScope.length === 0 ? [] : (await db.query<{ person_id: string; measurement_id: string; period_start: Date; period_end: Date; interactions: string }>(
      `select c.person_id, m.id measurement_id, m.period_start, m.period_end, m.interactions
       from unnest($3::uuid[]) c(person_id)
       cross join lateral (
         select recent.*, row_number() over (order by (recent.interactions > 0) desc, recent.period_end desc) position
         from (
           select m.id, m.period_start, m.period_end,
                  (select count(*) from interactions i
                    where i.organization_id = $1 and i.operator_id = c.person_id and i.started_at >= m.period_start
                      and i.started_at < case when m.period_end > m.period_start then m.period_end else m.period_start + interval '1 day' end) interactions
           from indicator_measurements m
           where m.organization_id = $1 and m.indicator_definition_id = $2 and m.subject_type = 'PERSON' and m.subject_id = c.person_id
           order by m.period_end desc limit ${SIMULATION_RECENT_MEASUREMENTS}
         ) recent
       ) m
       where m.position <= ${SIMULATION_MEASUREMENTS_PER_PERSON}
       order by c.person_id, m.position`,
      [organizationId, request.params.indicatorId, inScope.map((row) => row.person_id)],
    )).rows
    const byPerson = new Map<string, { id: string; periodLabel: string; interactions: number }[]>()
    for (const row of measurements) {
      const start = localDateOf(new Date(row.period_start), timeZone)
      const endCandidate = localDateOf(new Date(new Date(row.period_end).getTime() - 1), timeZone)
      const list = byPerson.get(row.person_id) ?? []
      list.push({ id: row.measurement_id, periodLabel: periodLabelOf(start, endCandidate < start ? start : endCandidate), interactions: Number(row.interactions) })
      byPerson.set(row.person_id, list)
    }
    const collaborators = inScope.map((row) => ({ id: row.person_id, name: row.name, measurements: byPerson.get(row.person_id) ?? [] }))
    const agents = (await db.query<{ id: string; name: string }>(`select id, name from agents where organization_id = $1 and active order by name`, [organizationId])).rows
    response.json({ data: { collaborators, agents } })
  })

  router.post("/indicators/:indicatorId/simulate", async (request, response) => {
    const { organizationId } = session(request)
    const body = simulateBodySchema.parse(request.body)
    if (!(await personInScope(organizationId, await scopesOf(request), body.collaboratorId))) throw new DomainError("Colaborador não encontrado.", "NOT_FOUND", 404)
    response.json({ data: await simulateDiagnosticStrategy(db, organizationId, { indicatorId: request.params.indicatorId, ...body }) })
  })

  return router
}
