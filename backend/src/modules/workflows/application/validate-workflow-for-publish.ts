import type { Database } from "../../../infrastructure/database/pool.js"
import { flowGraphSchema, type FlowGraph } from "../domain/graph-schema.js"
import { triggerDataOriginOf, triggerIndicatorCodeOf } from "../domain/trigger-config-schema.js"
import type { PublishCatalogContext, PublishGraphContext, PublishTriggerContext, PublishValidationOptions, PublishValidationRow } from "./publish-validation/context.js"
import { validateBranchEdges, validateDraftConfigurationModes, validateGraphShape, validateInteractionFeedbackSource, validateManualTriggerMode, validatePaidCycles, validateScheduleDataSources, validateTranscriptRequirements } from "./publish-validation/trigger-context.js"
import { validateConditions } from "./publish-validation/conditions.js"
import { validateAgentHasOutput, validateAgentReferences, validateVariables } from "./publish-validation/actions.js"
import { loadWorkflowOrchestrators, validateOrchestratorReferences } from "./publish-validation/orchestrators.js"
import { validateEscalations, validateHumanReviewTargets, validateFixedRecipients } from "./publish-validation/review-escalation.js"
import { validateOutputContent } from "./publish-validation/outputs.js"
import { validateConsolidatedStructure, validateRankings, validateSelectionCriteria } from "./publish-validation/fan-out.js"
import { validateIndicatorDiagnosis, validateIndicatorUsage, validatePrvClosingDiagnosis } from "./publish-validation/indicator-diagnosis.js"
import { validateReliableFeedbackFlow } from "./publish-validation/reliable-feedback.js"
import { validateInterventionPolicyReferences, validateInterventionPolicySources } from "./publish-validation/intervention-policy.js"

export { type PublishValidationRow, type PublishValidationOptions } from "./publish-validation/context.js"
export { parseSourcePath } from "./publish-validation/source-paths.js"
export { validateScheduleTrigger, validateManualTrigger, normalizeManualTrigger, triggerAllowsConsolidatedMode, triggerAllowsPopulationFilter } from "./publish-validation/trigger-context.js"
export { validateDataConditionConfig } from "./publish-validation/conditions.js"
export { type IndividualOnlyConflict, findIndividualOnlyConflict, findEmployeeCollectionConflict, validateFanOutConvergence, throwConflict } from "./publish-validation/fan-out.js"
export { validateReliableFeedbackFlow } from "./publish-validation/reliable-feedback.js"

/**
 * Validação de publicação de um Workflow — a ÚNICA fonte de verdade do que "Publicar" exige.
 * Extraída do router (rodada de hardening dos Workflows-modelo, 2026-09-16) por dois motivos:
 * (1) camada certa — regra de domínio/aplicação, não de transporte HTTP; (2) reuso literal por
 * `POST /:id/validate` (dry-run: mesma validação, zero escrita — é o que permite dizer que um
 * DRAFT é "publicável" sem publicar) e por `POST /:id/publish` (valida e só então grava a versão).
 * Nunca duas implementações: o dry-run chama exatamente esta função.
 *
 * Contrato: lança `DomainError` no PRIMEIRO problema encontrado (mesmo comportamento de sempre do
 * publish — o frontend já lista todos os problemas por conta própria em workflow-validation.ts,
 * que espelha estas regras); `details.nodeId` carrega o nó responsável quando a regra é de um nó
 * específico, pra UI poder navegar até ele.
 */
export async function validateWorkflowForPublish(db: Database, organizationId: string, workflowId: string, row: PublishValidationRow, options: PublishValidationOptions = {}): Promise<FlowGraph> {
  const graph = flowGraphSchema.parse(row.draftGraph)
  const triggerNodes = graph.nodes.filter((node) => node.type === "trigger")
  const context: PublishGraphContext = { db, organizationId, row, options, graph, triggerNodes }
  // Cada família de regra mora em publish-validation/<família>.ts; a ordem das chamadas é a ordem dos erros.
  validateGraphShape(context)
  validateManualTriggerMode(context)
  await validateConsolidatedStructure(context)
  validateAgentHasOutput(context)

  const trigger = row.triggerConfig
  // Origem de dados (o que a matrícula carrega): Flag/Indicador/Agenda são a própria origem; o Manual herda a do contexto
  // declarado — interação ≈ Flag, medição ≈ Indicador, colaborador ≈ Agenda individual (trigger-config-schema.ts).
  const origin = triggerDataOriginOf(trigger)
  const triggerIndicatorCode = triggerIndicatorCodeOf(trigger)
  const triggerContext: PublishTriggerContext = { ...context, trigger, origin, triggerIndicatorCode }
  validateInteractionFeedbackSource(triggerContext)

  validateReliableFeedbackFlow(graph, trigger, Boolean(row.consolidatedStructure))
  validateTranscriptRequirements(triggerContext)
  validatePrvClosingDiagnosis(triggerContext)
  await validateIndicatorDiagnosis(triggerContext)
  await validateScheduleDataSources(triggerContext)

  // Indicador nunca é booleano — só flag de canal pode ser. Só é relevante pro modo legado de
  // Condition (comparar o valor bruto do trigger) — histórico/resultado de node anterior não
  // dependem disso, e por isso são as únicas formas de Condition que um gatilho por agenda
  // suporta (ele não carrega nenhum "valor disparado" pra comparar).
  let legacyValueType: string | undefined = "NUMERIC"
  if (trigger.kind === "channel_flag") {
    const flag = await db.query<{ value_type: string }>(`select value_type from channel_flags where id = $1`, [trigger.channelFlagId])
    legacyValueType = flag.rows[0]?.value_type
  }

  // Pré-carrega, de uma vez, tudo que a validação tipada (abaixo) pode precisar — nunca dentro
  // do loop, pra não disparar N queries por Condition. Um workflow sem nenhuma Condition
  // sourcePath/variável não paga nada por isso (mapas vazios).
  const variableRows = await db.query<{ id: string; type: string; name: string }>(`select id, type, name from workflow_variables where workflow_id = $1`, [
    workflowId,
  ])
  const variablesById = new Map(variableRows.rows.map((row) => [row.id, row.type]))
  // Só pra mensagem amigável de ciclo entre variáveis (nunca mostra UUID pro admin).
  const variableNamesById = new Map(variableRows.rows.map((row) => [row.id, row.name]))
  const { orchestratorSchemasById, orchestratorRowsById } = await loadWorkflowOrchestrators(triggerContext)
  const catalogContext: PublishCatalogContext = { ...triggerContext, legacyValueType, variablesById, variableNamesById, orchestratorSchemasById, orchestratorRowsById }
  validateConditions(catalogContext)
  validateSelectionCriteria(catalogContext)
  await validateIndicatorUsage(catalogContext)
  await validateRankings(catalogContext)
  validateHumanReviewTargets(catalogContext)
  validateOutputContent(catalogContext)
  validateEscalations(catalogContext)
  validateVariables(catalogContext)
  validateInterventionPolicySources(catalogContext)
  await validateAgentReferences(catalogContext)
  await validateOrchestratorReferences(catalogContext)
  await validateFixedRecipients(catalogContext)
  await validateInterventionPolicyReferences(catalogContext)
  validateDraftConfigurationModes(catalogContext)
  validatePaidCycles(graph)
  validateBranchEdges(graph)

  return graph
}
