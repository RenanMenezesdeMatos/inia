import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { dateParam, listParam, paginationQuerySchema, searchParam } from "../../../shared/presentation/list-query.js"
import { canManageScope, getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { resolveOrganizationTimezone } from "../application/organization-timezone.js"
import { addDays, localDateParts, zonedTimeToIso } from "../application/schedule-recurrence.js"
import { loadDispatchDetail, loadResultsPage, loadResultsSummary, type ResultsFilters } from "../application/workflow-results-reader.js"

/**
 * V1.5.13 — aba "Resultados" do editor de Workflow (read model; nenhuma escrita):
 *
 *   GET /:id/results/summary              → cards do período
 *   GET /:id/results                      → disparos (matrícula raiz), paginados no servidor
 *   GET /:id/results/:rootEnrollmentId    → pessoas do disparo (paginadas) com feedback final, Outputs e uso de IA
 *
 * Montado sob `/api/v1/admin/workflows` (já exige `workflows.manage`). Aqui: organização da SESSÃO (nunca a constante do
 * router antigo), o Workflow precisa estar no escopo de gestão de quem pergunta (senão 404 sem distinguir) e cada pessoa
 * só aparece se estiver nesse escopo (ver workflow-results-reader.ts). Período em datas LOCAIS da organização; padrão =
 * últimos 30 dias (hoje incluso).
 */
const statusSchema = z.enum(["RUNNING", "COMPLETED", "PARTIAL", "FAILED"])
const triggerKindSchema = z.enum(["FLAG", "INDICATOR", "SCHEDULE", "MANUAL"])

const filtersSchema = z.object({
  from: dateParam,
  to: dateParam,
  status: listParam(statusSchema),
  triggerKind: listParam(triggerKindSchema),
  collaborator: searchParam,
})

const DEFAULT_PERIOD_DAYS = 30
const NOT_FOUND = { error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow não encontrado." } }
const DISPATCH_NOT_FOUND = { error: { code: "WORKFLOW_DISPATCH_NOT_FOUND", message: "Disparo não encontrado." } }

/** Período local [from, to] (inclusivo) → instantes [início de from, início do dia seguinte a to). */
export function resolveResultsPeriod(timeZone: string, now: Date, from?: string, to?: string): { from: string; to: string; fromInstant: Date; toInstant: Date } {
  const today = localDateParts(now, timeZone).date
  const end = to ?? today
  const start = from ?? addDays(end, -(DEFAULT_PERIOD_DAYS - 1))
  const [lower, upper] = start <= end ? [start, end] : [end, start]
  return { from: lower, to: upper, fromInstant: new Date(zonedTimeToIso(lower, "00:00", timeZone)), toInstant: new Date(zonedTimeToIso(addDays(upper, 1), "00:00", timeZone)) }
}

export function createWorkflowResultsRouter(db: Database) {
  const router = Router()

  async function authorize(request: Parameters<Parameters<typeof router.get>[1]>[0]) {
    const user = request.user!
    const workflow = await db.query<{ scopeType: string; teamId: string | null; subteamId: string | null }>(
      `select scope_type "scopeType", team_id "teamId", subteam_id "subteamId" from workflows where id = $1 and organization_id = $2`,
      [request.params.id, user.organizationId],
    )
    const row = workflow.rows[0]
    if (!row) return null
    const scopes = await getManageableScopes(db, user, "workflows.manage")
    if (!canManageScope(scopes, row)) return null
    return { organizationId: user.organizationId, scopes }
  }

  async function filtersOf(organizationId: string, query: unknown) {
    const input = filtersSchema.parse(query)
    const period = resolveResultsPeriod(await resolveOrganizationTimezone(db, organizationId), new Date(), input.from, input.to)
    const filters: ResultsFilters = { from: period.fromInstant, to: period.toInstant, statuses: input.status, triggerKinds: input.triggerKind, collaborator: input.collaborator }
    return { filters, period }
  }

  router.get("/:id/results/summary", async (request, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return response.status(404).json(NOT_FOUND)
    const access = await authorize(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    const { filters, period } = await filtersOf(access.organizationId, request.query)
    const summary = await loadResultsSummary(db, access.organizationId, request.params.id!, access.scopes, filters)
    response.json({ data: { ...summary, period: { from: period.from, to: period.to } } })
  })

  router.get("/:id/results", async (request, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return response.status(404).json(NOT_FOUND)
    const access = await authorize(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    const { filters } = await filtersOf(access.organizationId, request.query)
    const { page, pageSize } = paginationQuerySchema.parse(request.query)
    response.json({ data: await loadResultsPage(db, access.organizationId, request.params.id!, access.scopes, filters, page, pageSize) })
  })

  router.get("/:id/results/:rootEnrollmentId", async (request, response) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return response.status(404).json(NOT_FOUND)
    const access = await authorize(request)
    if (!access) return response.status(404).json(NOT_FOUND)
    if (!z.string().uuid().safeParse(request.params.rootEnrollmentId).success) return response.status(404).json(DISPATCH_NOT_FOUND)
    const { page, pageSize } = paginationQuerySchema.extend({ pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query)
    const detail = await loadDispatchDetail(db, access.organizationId, request.params.id!, access.scopes, request.params.rootEnrollmentId!, page, pageSize)
    if (!detail) return response.status(404).json(DISPATCH_NOT_FOUND)
    response.json({ data: detail })
  })

  return router
}
