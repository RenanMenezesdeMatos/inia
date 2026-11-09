import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { canManageScope, getManageableScopes } from "../../../auth/application/manageable-scopes.js"
import { parseDraftGraph } from "../../domain/draft-graph.js"
import { findEmployeeCollectionConflict, findIndividualOnlyConflict, throwConflict, validateFanOutConvergence, validateWorkflowForPublish } from "../../application/validate-workflow-for-publish.js"
import { computeGoLiveImpact } from "../../application/go-live-impact.js"
import { draftConfigurationOf, publishWorkflow } from "../../application/publish-workflow.js"
import { discardDraftConfiguration, writeDraftConfiguration } from "../../application/workflow-configuration-store.js"
import { deleteWorkflowLogically } from "../../application/logical-workflow-deletion.js"
import { consolidatedStructureAnchorId, consolidatedStructureSchema } from "../../domain/consolidated-structure-schema.js"
import { populationFilterAnchorId, populationFilterGroupRef, populationFilterSchema } from "../../domain/population-filter-schema.js"
import { structureAnchorGroupRef } from "../../domain/structure-anchor-schema.js"
import { NOT_FOUND, WORKFLOW_LIST_SELECT, assertAnchorInScope, canManageWorkflow, fetchScopedRow, normalizedPopulationFilter, triggerAllowsConsolidatedMode, triggerAllowsPopulationFilter } from "./shared.js"
import { sessionUser } from "../../../auth/presentation/session-user.js"

// O grafo é lido por `parseDraftGraph`: o rascunho aceita em branco o que a pessoa ainda vai preencher; só publicar exige tudo.
const saveDraftSchema = z.object({ graph: z.unknown() })

/** O `fingerprint` do impacto que a pessoa viu e confirmou (go-live-impact.ts) — exigido quando o impacto pede confirmação. */
const publishSchema = z.object({ confirmation: z.string().trim().min(1).max(64).optional() })

// Modo de avaliação (Individual x Consolidado): nunca uma coluna própria — derivado de
// `consolidated_structure` (presente = Consolidado). O corpo da requisição é explícito sobre o
// modo pra deixar a intenção clara na API, mas a persistência sempre grava os dois campos juntos
// (um deles sempre null).
const updateAnalysisConfigSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("INDIVIDUAL"), populationFilter: populationFilterSchema.nullable() }),
  z.object({ mode: z.literal("CONSOLIDATED"), consolidatedStructure: consolidatedStructureSchema }),
])

/** Rascunho do grafo, configuração da análise, validação (dry-run), publicação e exclusão. Registradas na ordem original (ver workflow-router.ts). */
export function registerWorkflowLifecycleRoutes(router: Router, db: Database): void {

  router.put("/:id/draft", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = saveDraftSchema.parse(request.body)
    const graph = parseDraftGraph(input.graph)
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    await db.query(`update workflows set draft_graph = $1, updated_at = now() where id = $2 and organization_id = $3`, [
      JSON.stringify(graph),
      request.params.id,
      organizationId,
    ])
    response.json({ data: { id: request.params.id } })
  })

  // Modo de avaliação — configuração própria do Workflow, nunca repetida em Node nenhum (mesmo
  // espírito de Abrangência). Como o Gatilho e a Abrangência, é RASCUNHO até Publicar: grava só
  // `draft_consolidated_structure`/`draft_population_filter` (workflow-configuration-store.ts) e é
  // registrada na versão publicada. Individual x Consolidado NUNCA é uma escolha real fora de Agenda de calendário — Flag/
  // Indicador já têm um sujeito individual implícito no próprio evento, e Agenda relativa ao
  // expediente é por definição individual (uma jornada é de uma pessoa só) — o backend rejeita
  // essas combinações mesmo se o payload vier manual, nunca confia só no frontend escondendo a
  // opção.
  router.put("/:id/analysis-config", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = updateAnalysisConfigSchema.parse(request.body)
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

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
      const draftGraph = parseDraftGraph(current.draftGraph)
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
      await writeDraftConfiguration(db, organizationId, request.params.id!, { analysis: { consolidatedStructure: input.consolidatedStructure, populationFilter: null } })
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
      await writeDraftConfiguration(db, organizationId, request.params.id!, { analysis: { consolidatedStructure: null, populationFilter: normalizedPopulationFilter(input.populationFilter) } })
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
    const organizationId = sessionUser(request).organizationId
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)
    try {
      await validateWorkflowForPublish(db, organizationId, request.params.id!, current)
      response.json({ data: { valid: true, error: null } })
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      const nodeId = typeof (error.details as { nodeId?: unknown } | undefined)?.nodeId === "string" ? (error.details as { nodeId: string }).nodeId : null
      response.json({ data: { valid: false, error: { code: error.code, message: error.message, nodeId } } })
    }
  })

  /**
   * Prévia do que PUBLICAR o rascunho agora faria no runtime (go-live-impact.ts): o que muda na
   * configuração e, para Agenda, a população, o catch-up imediato de hoje e o primeiro disparo. Zero
   * escrita. A tela abre o diálogo de publicação com isto; `POST /:id/publish` recalcula e recusa
   * (409) quando o impacto exige confirmação e o fingerprint não veio — o mesmo cálculo, nunca dois.
   */
  router.get("/:id/publish-impact", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)
    const impact = await computeGoLiveImpact(db, organizationId, {
      workflowId: request.params.id!,
      reason: "PUBLISH",
      configuration: draftConfigurationOf(current),
      published: current.published ? current.live : null,
      active: current.active,
      now: new Date(),
    })
    response.json({ data: impact })
  })

  // Publicar: o ÚNICO caminho do rascunho (grafo + configuração) para o que o runtime lê (publish-workflow.ts).
  router.post("/:id/publish", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const input = publishSchema.parse(request.body ?? {})
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    const published = await publishWorkflow(db, {
      organizationId,
      workflowId: request.params.id!,
      actorPersonId: request.user?.personId ?? null,
      confirmation: input.confirmation ?? null,
      canManageScope: (scope) => canManageScope(scopes, scope),
    })
    if (!published) return response.status(404).json(NOT_FOUND)

    const listResult = await db.query(`${WORKFLOW_LIST_SELECT} and w.id = $2`, [organizationId, request.params.id])
    response.json({ data: listResult.rows[0] })
  })

  // "Descartar alterações de configuração": o rascunho volta a ser a configuração publicada (o grafo
  // em rascunho não é tocado). Sem versão publicada não há configuração publicada para voltar.
  router.post("/:id/configuration/discard", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)
    if (!current.published) {
      throw new DomainError("Este workflow ainda não foi publicado — não há configuração publicada para restaurar.", "WORKFLOW_NOT_PUBLISHED", 409)
    }
    await discardDraftConfiguration(db, organizationId, request.params.id!)
    const listResult = await db.query(`${WORKFLOW_LIST_SELECT} and w.id = $2`, [organizationId, request.params.id])
    response.json({ data: listResult.rows[0] })
  })

  router.delete("/:id", async (request, response) => {
    const organizationId = sessionUser(request).organizationId
    const current = await fetchScopedRow(db, organizationId, request.params.id!)
    if (!current) return response.status(404).json(NOT_FOUND)
    const scopes = await getManageableScopes(db, sessionUser(request), "workflows.manage")
    if (!canManageWorkflow(scopes, current)) return response.status(404).json(NOT_FOUND)

    // Exclusão lógica: nada é apagado, e o histórico continua na Central de Dados.
    const deleted = await deleteWorkflowLogically(db, { organizationId, workflowId: request.params.id!, actorPersonId: sessionUser(request).personId ?? null })
    if (!deleted) return response.status(404).json(NOT_FOUND)
    response.status(204).send()
  })
}
