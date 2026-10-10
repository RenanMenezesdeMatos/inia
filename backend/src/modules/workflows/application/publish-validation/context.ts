import type { Database } from "../../../../infrastructure/database/pool.js"
import type { FlatOutputSchemaField } from "../../../assistant/domain/output-schema-fields.js"
import type { FlowGraph, FlowNode } from "../../domain/graph-schema.js"
import type { ConsolidatedStructure } from "../../domain/consolidated-structure-schema.js"
import type { TriggerConfig, TriggerDataOrigin } from "../../domain/trigger-config-schema.js"
import type { OrganizationalHierarchyReader } from "../organizational-recipient.js"

// Tipos da validação de publicação (validate-workflow-for-publish.ts).

/** Contexto que `validateWorkflowForPublish` (validate-workflow-for-publish.ts) monta em ETAPAS e passa a cada família de
 * regra, na ordem original (o publish para no primeiro problema — a ordem das famílias é a ordem dos erros). Etapa 1: o grafo. */
export type PublishGraphContext = {
  db: Database
  organizationId: string
  row: PublishValidationRow
  options: PublishValidationOptions
  graph: FlowGraph
  triggerNodes: FlowNode[]
}

/** Etapa 2: + o gatilho e a origem de dados que ele carrega (interação, medição ou só o colaborador). */
export type PublishTriggerContext = PublishGraphContext & {
  trigger: TriggerConfig
  origin: TriggerDataOrigin
  triggerIndicatorCode: string | null
}

/** Etapa 3: + o que vem do banco antes das regras de Condition, Variável e Orquestrador. */
export type PublishCatalogContext = PublishTriggerContext & {
  legacyValueType: string | undefined
  variablesById: Map<string, string>
  variableNamesById: Map<string, string>
  orchestratorSchemasById: Map<string, FlatOutputSchemaField[] | null>
  orchestratorRowsById: Map<string, { name: string; active: boolean; invocation_mode: string }>
}

export type PublishValidationRow = {
  scopeType: string
  teamId: string | null
  subteamId: string | null
  draftGraph: unknown
  triggerConfig: TriggerConfig
  consolidatedStructure: ConsolidatedStructure | null
}

export type PublishValidationOptions = {
  /** Leitor da hierarquia pra resolver destinatário de gestão por estrutura — Postgres por padrão;
   * injetável só pra testes (catálogo oficial roda sobre a estrutura demo em memória). */
  hierarchy?: OrganizationalHierarchyReader
}
