import { DomainError } from "../../../../shared/domain/domain-error.js"
import { findAncestorNodeIds, type FlowGraph, type HierarchicalTarget } from "../../domain/graph-schema.js"
import type { PublishCatalogContext, PublishGraphContext } from "./context.js"
import { validateConversationalSurfaceContent } from "./outputs.js"

// Família REVISÃO HUMANA E ESCALONAMENTO: revisor relativo a uma revisão anterior e conteúdo escalonado.
// Espelho no editor: workflow-validation/review-escalation.ts.

/**
 * `target.type === "ROLE_OF_PREVIOUS_REVIEWER"` precisa apontar pra um node `human_review` que
 * seja ancestral REAL do node que o usa (por edges, nunca posição visual) — reaproveitada tanto
 * pelo próprio Human Review (`reviewTarget`) quanto pela Action Escalonar (`target`), já que os
 * dois usam o mesmo `HierarchicalTarget` e o "revisor anterior" só existe mesmo pra Human Review
 * (é lá que `node_outputs[id].reviewerId` é gravado, na rota de decisão).
 */
function validatePreviousReviewerTarget(graph: FlowGraph, nodeId: string, label: string, target: HierarchicalTarget, errorCode: string): void {
  if (target.type !== "ROLE_OF_PREVIOUS_REVIEWER") return
  const previousNode = graph.nodes.find((candidate) => candidate.id === target.previousReviewNodeId)
  if (!previousNode || previousNode.type !== "human_review") {
    throw new DomainError(`O nó "${label}" referencia uma revisão anterior que não existe.`, errorCode, 422)
  }
  if (!findAncestorNodeIds(graph, nodeId).has(previousNode.id)) {
    throw new DomainError(`O nó "${label}" só pode se relacionar com uma revisão que vem ANTES dele no fluxo.`, errorCode, 422)
  }
}

/**
 * Pessoa FIXA escolhida no editor (Output "Usuário específico", revisor/escalonamento "Pessoa específica"): precisa existir,
 * estar ativa e ser DESTA organização (achado A-F10) — antes qualquer uuid passava e o resultado (feedback, pendência de
 * revisão) seria entregue a quem estivesse por trás dele. Lido do grafo inteiro, qualquer que seja o nó.
 */
export async function validateFixedRecipients(context: PublishGraphContext): Promise<void> {
  const { db, organizationId, graph } = context
  const ids = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if ((record.type === "USER" || record.type === "SPECIFIC_USER") && typeof record.userId === "string") ids.add(record.userId)
    Object.values(record).forEach(visit)
  }
  visit(graph.nodes.map((node) => node.config))
  if (ids.size === 0) return
  const found = await db.query<{ id: string }>(`select id from people where id = any($1::uuid[]) and organization_id = $2 and active`, [[...ids], organizationId])
  const valid = new Set(found.rows.map((row) => row.id))
  const missing = [...ids].filter((id) => !valid.has(id))
  if (missing.length > 0) throw new DomainError("Uma pessoa escolhida como destinatário ou revisor não existe mais, está inativa ou não pertence a esta organização.", "WORKFLOW_RECIPIENT_NOT_FOUND", 422, { personIds: missing })
}

/** Revisor relativo a uma revisão anterior que exista e venha antes no fluxo. */
export function validateHumanReviewTargets(context: PublishGraphContext): void {
  const { graph } = context
  for (const node of graph.nodes) {
    if (node.type !== "human_review") continue
    validatePreviousReviewerTarget(graph, node.id, node.label, node.config.reviewTarget, "WORKFLOW_INVALID_HUMAN_REVIEW")
  }
}

/** Escalonar: revisor anterior real e conteúdo compatível com Avatar/Chat. */
export function validateEscalations(context: PublishCatalogContext): void {
  const { graph, orchestratorSchemasById } = context
  // Action Escalonar — Target + Conteúdo + Surface, reaproveitando as MESMAS 2 validações
  // acima (nunca uma 3ª implementação): revisor anterior precisa ser ancestral real, e a
  // mesma guarda de Avatar/Chat contra objeto/lista crua também vale pro conteúdo escalonado.
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "ESCALATE") continue
    validatePreviousReviewerTarget(graph, node.id, node.label, node.config.target, "WORKFLOW_INVALID_ACTION")
    if (node.config.contentSource) {
      validateConversationalSurfaceContent(graph, node.label, node.config.contentSource, node.config.surfaces, orchestratorSchemasById, "WORKFLOW_INVALID_ACTION")
    }
  }
}
