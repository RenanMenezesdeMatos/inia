import { Router } from "express"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { getManageableScopes } from "../../../auth/application/manageable-scopes.js"
import type { FlowGraph } from "../../domain/graph-schema.js"
import { parseSourcePath } from "../../application/validate-workflow-for-publish.js"
import { createWorkflowVariableSchema, updateWorkflowVariableSchema } from "../../domain/workflow-variable-schema.js"
import { NOT_FOUND, canManageWorkflow, fetchScopedRow } from "./shared.js"
import { sessionUser } from "../../../auth/presentation/session-user.js"

function graphReferencesVariable(graph: FlowGraph, variableId: string): boolean {
  return graph.nodes.some((node) => {
    if (node.type === "condition") return parseSourcePath(node.config.sourcePath ?? "")?.kind === "variable" && node.config.sourcePath === `variables.${variableId}`
    if (node.type === "action") return node.config.actionType === "SET_VARIABLE" && node.config.variableId === variableId
    return false
  })
}

/** Variáveis do Workflow. Registradas na ordem original (ver workflow-router.ts). */
export function registerWorkflowVariableRoutes(router: Router, db: Database): void {

  // ---------------------------------------------------------------------------------------
  // Workflow Variables — definição (nome/tipo) vive no Workflow, não na versão publicada
  // (renomear não deve exigir republicar). Valores em runtime ficam em
  // workflow_enrollments.variables, nunca aqui.
  // ---------------------------------------------------------------------------------------

  router.get("/:id/variables", async (request, response) => {
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    const result = await db.query(
      `select id, name, type, created_at "createdAt" from workflow_variables where workflow_id = $1 order by created_at`,
      [request.params.id],
    )
    response.json({ data: result.rows })
  })

  router.post("/:id/variables", async (request, response) => {
    const input = createWorkflowVariableSchema.parse(request.body)
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    const result = await db.query<{ id: string; name: string; type: string; createdAt: string }>(
      `insert into workflow_variables(workflow_id, name, type) values ($1,$2,$3) returning id, name, type, created_at "createdAt"`,
      [request.params.id, input.name, input.type],
    )
    response.status(201).json({ data: result.rows[0] })
  })

  router.patch("/:id/variables/:variableId", async (request, response) => {
    const input = updateWorkflowVariableSchema.parse(request.body)
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    const result = await db.query<{ id: string; name: string; type: string; createdAt: string }>(
      `update workflow_variables set name = $1 where id = $2 and workflow_id = $3 returning id, name, type, created_at "createdAt"`,
      [input.name, request.params.variableId, request.params.id],
    )
    if (!result.rows[0]) return response.status(404).json({ error: { code: "WORKFLOW_VARIABLE_NOT_FOUND", message: "Variável não encontrada." } })
    response.json({ data: result.rows[0] })
  })

  router.delete("/:id/variables/:variableId", async (request, response) => {
    const current = await fetchScopedRow(db, sessionUser(request).organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    const graphsResult = await db.query<{ draft_graph: FlowGraph; published_graph: FlowGraph | null }>(
      `select w.draft_graph, (select graph from workflow_versions where id = w.active_version_id) published_graph
       from workflows w where w.id = $1`,
      [request.params.id],
    )
    const variableId = request.params.variableId!
    const referenced = [graphsResult.rows[0]?.draft_graph, graphsResult.rows[0]?.published_graph]
      .filter((graph): graph is FlowGraph => Boolean(graph))
      .some((graph) => graphReferencesVariable(graph, variableId))
    if (referenced) {
      throw new DomainError(
        "Esta variável está em uso por um ou mais nós deste workflow (rascunho ou versão publicada) — remova as referências antes de excluí-la.",
        "WORKFLOW_VARIABLE_IN_USE",
        409,
      )
    }

    await db.query(`update workflow_variables_all set deleted_at = now(), deleted_by_person_id = $3 where id = $1 and workflow_id = $2 and deleted_at is null`, [variableId, request.params.id, sessionUser(request).personId ?? null])
    response.status(204).send()
  })
}
