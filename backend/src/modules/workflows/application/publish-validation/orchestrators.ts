import { DomainError } from "../../../../shared/domain/domain-error.js"
import { scopesAreCompatible } from "../../../auth/application/manageable-scopes.js"
import type { FlatOutputSchemaField } from "../../../assistant/domain/output-schema-fields.js"
import { resolveEffectiveStructuredOutput } from "../../../assistant/domain/structured-output-definition.js"
import type { PublishCatalogContext, PublishTriggerContext } from "./context.js"

// Família ORQUESTRADOR: carga (com a abrangência) e referências do nó Orquestrador, inclusive o roteamento declarado.
// Só backend: depende do banco (no editor, a configuração do nó: workflow-validation/orchestrators.ts).

/** Carrega os Orquestradores usados (catálogo de campos pelo mesmo dual-read do runtime) e recusa os de outro Grupo. */
export async function loadWorkflowOrchestrators(context: PublishTriggerContext): Promise<Pick<PublishCatalogContext, "orchestratorSchemasById" | "orchestratorRowsById">> {
  const { db, organizationId, row, graph } = context
  const orchestratorIds = [...new Set(graph.nodes.filter((node) => node.type === "orchestrator").map((node) => node.config.orchestratorId))]
  const orchestratorSchemasById = new Map<string, FlatOutputSchemaField[] | null>()
  const orchestratorRowsById = new Map<string, { name: string; active: boolean; invocation_mode: string }>()
  if (orchestratorIds.length > 0) {
    const schemaRows = await db.query<{ id: string; output_schema: unknown; structured_output?: unknown; output_instructions?: string | null; scopeType: string; teamId: string | null; subteamId: string | null; name: string; active: boolean; invocation_mode: string }>(
      `select id, output_schema, structured_output, output_instructions, scope_type "scopeType", team_id "teamId", subteam_id "subteamId", name, active, invocation_mode
       from assistant_orchestrators where id = any($1::uuid[]) and organization_id = $2`,
      [orchestratorIds, organizationId],
    )
    for (const orchestratorRow of schemaRows.rows) {
      orchestratorRowsById.set(orchestratorRow.id, orchestratorRow)
      // Nunca vazamento cross-group (Parte 6/24 do pedido): um Orchestrator exclusivo de outro
      // grupo não pode ser chamado por este Workflow, mesmo que já estivesse salvo no rascunho
      // antes de uma troca de Abrangência — validado de novo a cada publish, nunca só na hora
      // de escolher no picker.
      if (!(await scopesAreCompatible(db, row, orchestratorRow))) {
        throw new DomainError(
          `O Orchestrator "${orchestratorRow.name}" não está disponível para o grupo deste workflow.`,
          "WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN",
          422,
        )
      }
      // Catálogo de campos pelo MESMO dual-read do runtime (definição nova ou legado convertido).
      orchestratorSchemasById.set(orchestratorRow.id, resolveEffectiveStructuredOutput({ structured_output: orchestratorRow.structured_output, output_schema: orchestratorRow.output_schema, output_instructions: orchestratorRow.output_instructions ?? null }).fields)
    }
  }
  return { orchestratorSchemasById, orchestratorRowsById }
}

/** Orquestrador de cada nó: existe, ativo, habilitado para Workflows e, no roteamento declarado, um especialista por domínio. */
export async function validateOrchestratorReferences(context: PublishCatalogContext): Promise<void> {
  const { db, organizationId, graph, orchestratorRowsById } = context
  // Referência que não resolve (Orchestrator excluído/de outra organização), inativo ou que
  // não aceita invocação por Workflow (`invocation_mode` INTERACTIVE) falhava só em runtime
  // (orchestrator-executor.ts) — um Workflow publicado que nunca produziria o resultado. Bug de
  // hardening: bloqueia no publish, com o nó responsável.
  for (const node of graph.nodes) {
    if (node.type !== "orchestrator") continue
    const found = orchestratorRowsById.get(node.config.orchestratorId)
    if (!found) {
      throw new DomainError(`O nó "${node.label}" referencia um Orquestrador que não existe mais.`, "WORKFLOW_ORCHESTRATOR_NOT_FOUND", 422, { nodeId: node.id })
    }
    if (found.active === false) {
      throw new DomainError(`O nó "${node.label}" usa o Orquestrador "${found.name}", que está inativo.`, "WORKFLOW_ORCHESTRATOR_INACTIVE", 422, { nodeId: node.id })
    }
    if (found.invocation_mode === "INTERACTIVE") {
      throw new DomainError(
        `O nó "${node.label}" usa o Orquestrador "${found.name}", que só atende chat/voz — escolha um Orquestrador habilitado para Workflows.`,
        "WORKFLOW_ORCHESTRATOR_INVALID_INVOCATION",
        422,
        { nodeId: node.id },
      )
    }
    // V1.7.1 — roteamento declarado: cada domínio precisa ser um domínio ATIVO da organização com EXATAMENTE um especialista
    // ativo de domínio neste Orquestrador. Ambiguidade em runtime (mudança depois do publish) volta para a IA; aqui bloqueia.
    if (node.config.routing?.mode === "DOMAINS") {
      const ids = [...new Set(node.config.routing.businessDomainIds)]
      const rows = await db.query<{ id: string; name: string; active: boolean; specialists: number }>(
        `select bd.id, bd.name, bd.active,
                (select count(*)::int from assistant_orchestrator_specialists s join agents a on a.id = s.agent_id
                  where s.orchestrator_id = $3 and a.active and a.specialty_kind = 'DOMAIN' and a.business_domain_id = bd.id) specialists
           from business_domains bd where bd.id = any($1::uuid[]) and bd.organization_id = $2`,
        [ids, organizationId, node.config.orchestratorId],
      )
      const byId = new Map(rows.rows.map((row) => [row.id, row]))
      for (const id of ids) {
        const domain = byId.get(id)
        if (!domain || !domain.active) throw new DomainError(`O nó "${node.label}" declara um domínio de negócio inexistente ou inativo no roteamento.`, "WORKFLOW_ORCHESTRATOR_ROUTING_DOMAIN_INVALID", 422, { nodeId: node.id })
        if (domain.specialists !== 1) {
          throw new DomainError(
            `O nó "${node.label}" declara o domínio "${domain.name}", mas o Orquestrador "${found.name}" tem ${domain.specialists === 0 ? "nenhum especialista ativo" : `${domain.specialists} especialistas ativos`} desse domínio — o roteamento declarado precisa de exatamente um.`,
            "WORKFLOW_ORCHESTRATOR_ROUTING_DOMAIN_INVALID",
            422,
            { nodeId: node.id },
          )
        }
      }
    }
  }
}
