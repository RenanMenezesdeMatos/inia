import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { booleanParam, dateParam, listParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../../shared/presentation/list-query.js"
import { applyManageableScopeFilter, canManageScope, getManageableScopes } from "../../../auth/application/manageable-scopes.js"
import type { FlowGraph } from "../../domain/graph-schema.js"
import { NOT_FOUND, WORKFLOW_LIST_SELECT } from "./shared.js"

const listWorkflowsSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  triggerKind: listParam(z.enum(["channel_flag", "indicator", "schedule", "manual"])),
  published: booleanParam,
  active: booleanParam,
  hasActiveEnrollments: booleanParam,
  createdFrom: dateParam,
  createdTo: dateParam,
})

/** Lista e detalhe de Workflows. Registradas na ordem original (ver workflow-router.ts). */
export function registerWorkflowQueryRoutes(router: Router, db: Database): void {

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = listWorkflowsSchema.parse(request.query)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.name", "q.description"])
      .in(`q.trigger ->> 'kind'`, input.triggerKind)
      .equals("q.published", input.published)
      .equals("q.active", input.active)
      .orgScope("q", input)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    if (input.hasActiveEnrollments !== undefined) filter.add(`q."activeEnrollments" ${input.hasActiveEnrollments ? ">" : "="} 0`)
    applyManageableScopeFilter(scopes, filter)
    const data = await respondList(db, request.query, { select: WORKFLOW_LIST_SELECT, filter, orderBy: 'q."createdAt" desc, q.id' })
    response.json({ data })
  })

  router.get("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const result = await db.query(`${WORKFLOW_LIST_SELECT} and w.id = $2`, [organizationId, request.params.id])
    if (!result.rows[0]) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageScope(scopes, result.rows[0])) return response.status(404).json(NOT_FOUND)

    const graphResult = await db.query<{ draft_graph: FlowGraph; published_graph: FlowGraph | null }>(
      `select w.draft_graph, (select graph from workflow_versions where id = w.active_version_id) published_graph
       from workflows w where w.id = $1`,
      [request.params.id],
    )
    response.json({
      data: { ...result.rows[0], draftGraph: graphResult.rows[0]!.draft_graph, publishedGraph: graphResult.rows[0]!.published_graph },
    })
  })
}
