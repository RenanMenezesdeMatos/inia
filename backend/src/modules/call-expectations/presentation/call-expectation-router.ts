import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { booleanParam, dateParam, orgScopeFilterSchema, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"


const listCallExpectationsSchema = orgScopeFilterSchema.extend({
  search: searchParam,
  active: booleanParam,
  subjectScopeType: z.enum(["ALL_SUBJECTS"]).optional(),
  subjectId: z.string().uuid().optional(),
  createdFrom: dateParam,
  createdTo: dateParam,
})

const SELECT_EXPECTATIONS = `
  select
    ce.id, ce.scope_type "scopeType", ce.team_id "teamId", t.name "teamName",
    ce.subteam_id "subteamId", st.name "subteamName",
    ce.subject_scope_type "subjectScopeType", ce.subject_id "subjectId", sub.name "subjectName",
    ce.expectation, ce.active, ce.created_at "createdAt"
  from call_expectations ce
  left join teams t on t.id = ce.team_id
  left join subteams st on st.id = ce.subteam_id
  left join subjects sub on sub.id = ce.subject_id
  where ce.organization_id = $1
`

export function createCallExpectationRouter(db: Database) {
  const router = Router()

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = listCallExpectationsSchema.parse(request.query)
    const filter = new SqlFilter([organizationId])
      .search(input.search, ["q.expectation", 'q."teamName"', 'q."subteamName"', 'q."subjectName"'])
      .equals("q.active", input.active)
      .orgScope("q", input)
      .dateRange('q."createdAt"', input.createdFrom, input.createdTo)
    if (input.subjectId) filter.equals('q."subjectId"', input.subjectId)
    else if (input.subjectScopeType === "ALL_SUBJECTS") filter.add(`q."subjectScopeType" = 'ALL_SUBJECTS'`)
    const data = await respondList(db, request.query, { select: SELECT_EXPECTATIONS, filter, orderBy: 'q."createdAt" desc, q.id' })
    response.json({ data })
  })

  // TRANSIÇÃO (migration 105): as Regras de chamada viraram ARGUMENTÁRIOS (`/api/v1/admin/argument-scripts`). Esta rota fica só
  // para leitura do cadastro antigo (preservado, nunca apagado); escrever aqui criaria uma regra que nenhuma análise lê.
  const moved = (_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) =>
    response.status(410).json({ error: { code: "CALL_EXPECTATIONS_MOVED", message: "As Regras de chamada agora são Argumentários. Use Administração › Argumentários." } })
  router.post("/", moved)
  router.patch("/:id", moved)
  router.delete("/:id", moved)

  return router
}
