import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { canManageScope, getManageableScopes } from "../../../auth/application/manageable-scopes.js"
import { flowGraphSchema } from "../../domain/graph-schema.js"
import { findEmployeeCollectionConflict, findIndividualOnlyConflict, throwConflict, validateFanOutConvergence, validateWorkflowForPublish, type PublishValidationRow } from "../../application/validate-workflow-for-publish.js"
import { consolidatedStructureAnchorId, consolidatedStructureSchema } from "../../domain/consolidated-structure-schema.js"
import { populationFilterAnchorId, populationFilterGroupRef, populationFilterSchema } from "../../domain/population-filter-schema.js"
import { structureAnchorGroupRef } from "../../domain/structure-anchor-schema.js"
import { NOT_FOUND, WORKFLOW_LIST_SELECT, assertAnchorInScope, triggerAllowsConsolidatedMode, triggerAllowsPopulationFilter, fetchScopedRow } from "./shared.js"

const saveDraftSchema = z.object({ graph: flowGraphSchema })

// Modo de avaliação (Individual x Consolidado): nunca uma coluna própria — derivado de
// `consolidated_structure` (presente = Consolidado). O corpo da requisição é explícito sobre o
// modo pra deixar a intenção clara na API, mas a persistência sempre grava os dois campos juntos
// (um deles sempre null).
const updateAnalysisConfigSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("INDIVIDUAL"), populationFilter: populationFilterSchema.nullable() }),
  z.object({ mode: z.literal("CONSOLIDATED"), consolidatedStructure: consolidatedStructureSchema }),
])

/** Linha mínima que a validação de publicação precisa (ver validate-workflow-for-publish.ts) —
 * compartilhada por `POST /:id/validate` (dry-run) e `POST /:id/publish`. */
async function fetchPublishRow(db: Database, organizationId: string, id: string): Promise<PublishValidationRow | null> {
  const result = await db.query<PublishValidationRow>(
    `select scope_type "scopeType", team_id "teamId", subteam_id "subteamId", draft_graph "draftGraph", trigger_config "triggerConfig",
            consolidated_structure "consolidatedStructure"
     from workflows where id = $1 and organization_id = $2`,
    [id, organizationId],
  )
  return result.rows[0] ?? null
}

/** Rascunho do grafo, configuração da análise, validação (dry-run), publicação e exclusão. Registradas na ordem original (ver workflow-router.ts). */
export function registerWorkflowLifecycleRoutes(router: Router, db: Database): void {

  router.put("/:id/draft", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = saveDraftSchema.parse(request.body)
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    await db.query(`update workflows set draft_graph = $1, updated_at = now() where id = $2 and organization_id = $3`, [
      JSON.stringify(input.graph),
      request.params.id,
      organizationId,
    ])
    response.json({ data: { id: request.params.id } })
  })

  // Modo de avaliação — configuração própria do Workflow, nunca repetida em Node nenhum (mesmo
  // espírito de Abrangência). Vive fora do grafo/versão publicada (mesma coluna mutável de
  // scope_type) porque é uma decisão operacional que pode mudar sem gerar uma nova versão do
  // fluxo. Individual x Consolidado NUNCA é uma escolha real fora de Agenda de calendário — Flag/
  // Indicador já têm um sujeito individual implícito no próprio evento, e Agenda relativa ao
  // expediente é por definição individual (uma jornada é de uma pessoa só) — o backend rejeita
  // essas combinações mesmo se o payload vier manual, nunca confia só no frontend escondendo a
  // opção.
  router.put("/:id/analysis-config", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = updateAnalysisConfigSchema.parse(request.body)
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    if (input.mode === "CONSOLIDATED") {
      if (!triggerAllowsConsolidatedMode(current.triggerConfig)) {
        throw new DomainError(
          current.triggerConfig.kind !== "schedule"
            ? "Modo Consolidado só está disponível para Agenda de calendário."
            : "Agendamentos relativos ao expediente são sempre executados individualmente por colaborador.",
          "WORKFLOW_CONSOLIDATED_MODE_INVALID_TRIGGER",
          422,
        )
      }
      // Performance do colaborador (Condition) e "O próprio operador" (Output) só fazem sentido
      // com um colaborador individual — bloqueia a troca de modo ANTES de gravar, em vez de
      // deixar isso só pro publish (Parte 29 do pedido: explicar o que precisa mudar primeiro).
      const draftGraph = flowGraphSchema.parse(current.draftGraph)
      const conflict = findIndividualOnlyConflict(draftGraph) ?? findEmployeeCollectionConflict(draftGraph) ?? validateFanOutConvergence(draftGraph)
      if (conflict) throwConflict(conflict)
      // A pessoa-âncora (Supervisor/Coordenador/Gerente/Gerente Sênior/Diretor) ou o Subgrupo/
      // Grupo escolhidos precisam estar DENTRO da Abrangência do Workflow — nunca "Workflow
      // FATURAS + Supervisor de RETENÇÃO".
      await assertAnchorInScope(
        db,
        organizationId,
        consolidatedStructureAnchorId(input.consolidatedStructure),
        structureAnchorGroupRef(input.consolidatedStructure),
        current,
        "A estrutura selecionada está fora da Abrangência deste workflow.",
        "WORKFLOW_CONSOLIDATED_STRUCTURE_OUT_OF_SCOPE",
        422,
      )
      await db.query(`update workflows set consolidated_structure = $1, population_filter = null, updated_at = now() where id = $2 and organization_id = $3`, [
        JSON.stringify(input.consolidatedStructure),
        request.params.id,
        organizationId,
      ])
    } else {
      if (input.populationFilter && input.populationFilter.kind !== "ALL" && !triggerAllowsPopulationFilter(current.triggerConfig)) {
        throw new DomainError("Filtro Populacional só está disponível para Agenda.", "WORKFLOW_POPULATION_FILTER_INVALID_TRIGGER", 422)
      }
      if (input.populationFilter && input.populationFilter.kind !== "ALL") {
        await assertAnchorInScope(
          db,
          organizationId,
          populationFilterAnchorId(input.populationFilter),
          populationFilterGroupRef(input.populationFilter),
          current,
          "O colaborador/grupo selecionado está fora da Abrangência deste workflow.",
          "WORKFLOW_POPULATION_FILTER_OUT_OF_SCOPE",
          422,
        )
      }
      await db.query(`update workflows set consolidated_structure = null, population_filter = $1, updated_at = now() where id = $2 and organization_id = $3`, [
        input.populationFilter ? JSON.stringify(input.populationFilter) : null,
        request.params.id,
        organizationId,
      ])
    }

    const result = await db.query(`${WORKFLOW_LIST_SELECT} and w.id = $2`, [organizationId, request.params.id])
    response.json({ data: result.rows[0] })
  })

  /**
   * Dry-run de publicação — roda EXATAMENTE a mesma validação de `POST /:id/publish`
   * (validateWorkflowForPublish) sem gravar versão nenhuma. É o gate "DRAFT válido = passa 100% na
   * validação do botão Publicar, mas continua rascunho" dos Workflows-modelo (rodada de hardening
   * 2026-09-16). Só `DomainError` vira `{ valid: false }`; qualquer outro erro sobe normalmente.
   */
  router.post("/:id/validate", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchPublishRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)
    try {
      await validateWorkflowForPublish(db, organizationId, request.params.id!, current)
      response.json({ data: { valid: true, error: null } })
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      const nodeId = typeof (error.details as { nodeId?: unknown } | undefined)?.nodeId === "string" ? (error.details as { nodeId: string }).nodeId : null
      response.json({ data: { valid: false, error: { code: error.code, message: error.message, nodeId } } })
    }
  })

  router.post("/:id/publish", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchPublishRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    const graph = await validateWorkflowForPublish(db, organizationId, request.params.id!, current)

    const client = await db.connect()
    try {
      await client.query("begin")
      const version = await client.query<{ id: string }>(
        `insert into workflow_versions(workflow_id, graph, created_by) values ($1,$2,$3) returning id`,
        [request.params.id, JSON.stringify(graph), request.user?.personId ?? null],
      )
      await client.query(`update workflows set active_version_id = $1, updated_at = now() where id = $2`, [version.rows[0]!.id, request.params.id])
      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }

    const listResult = await db.query(`${WORKFLOW_LIST_SELECT} and w.id = $2`, [organizationId, request.params.id])
    response.json({ data: listResult.rows[0] })
  })

  router.delete("/:id", async (request, response) => {
    const organizationId = request.user!.organizationId
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, request.user!, "workflows.manage")
    if (!canManageScope(scopes, current)) return response.status(404).json(NOT_FOUND)

    await db.query(`delete from workflows where id = $1 and organization_id = $2`, [request.params.id, organizationId])
    response.status(204).send()
  })
}
