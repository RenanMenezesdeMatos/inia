import type { Database } from "../../../infrastructure/database/pool.js"
import { isUuid, resolveAccessibleKnowledgeMaterials, type KnowledgeMaterialViewer } from "../../knowledge/application/knowledge-material-access.js"
import type { FeedbackSupportMaterialView } from "../../feedbacks/application/feedback-support-materials.js"
import { MAX_SUPPORT_MATERIALS_PER_RESPONSE, SUPPORT_MATERIAL_REASON_MAX_LENGTH, type SupportMaterialRecommendation } from "../../feedbacks/domain/support-material.js"

/**
 * Materiais de apoio recomendados numa RESPOSTA DE CHAT/VOZ — a persistência fora do Feedback
 * (`assistant_interaction_support_materials`, migration 073). Mesma validação e mesma resolução
 * por leitor do Feedback (`knowledge-material-access.ts`): o LLM escolheu entre candidatos reais,
 * o backend revalida contra o banco e o DESTINATÁRIO da resposta (o operador da conversa) e grava
 * só id + motivo + posição + proveniência (a interação já diz canal, operador, agente e instante;
 * `orchestrator_id` diz qual Orquestrador respondeu). Título/rota/acesso são resolvidos de novo em
 * cada leitura — reabrir a conversa depois de um material ter sido despublicado ou sair do alcance
 * mostra o marcador neutro, nunca o título.
 */
type Queryable = Pick<Database, "query">

export type AssistantSupportMaterialView = FeedbackSupportMaterialView

export async function persistAssistantSupportMaterials(
  db: Queryable,
  input: { organizationId: string; interactionId: string; recipient: KnowledgeMaterialViewer; orchestratorId: string | null; recommendations: SupportMaterialRecommendation[] | undefined },
): Promise<AssistantSupportMaterialView[]> {
  const recommendations = (input.recommendations ?? []).filter((recommendation) => isUuid(recommendation.materialId))
  if (recommendations.length === 0) return []
  const accessible = await resolveAccessibleKnowledgeMaterials(db, { organizationId: input.organizationId, viewer: input.recipient, materialIds: recommendations.map((item) => item.materialId) })
  const persisted: AssistantSupportMaterialView[] = []
  const seen = new Set<string>()
  const rejected: string[] = []
  for (const recommendation of recommendations) {
    const material = accessible.get(recommendation.materialId)
    if (!material || seen.has(recommendation.materialId) || persisted.length >= MAX_SUPPORT_MATERIALS_PER_RESPONSE) {
      rejected.push(recommendation.materialId)
      continue
    }
    seen.add(recommendation.materialId)
    const reason = recommendation.reason.trim().slice(0, SUPPORT_MATERIAL_REASON_MAX_LENGTH)
    await db.query(
      `insert into assistant_interaction_support_materials(organization_id, interaction_id, knowledge_document_id, orchestrator_id, reason, position)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (interaction_id, knowledge_document_id) do nothing`,
      [input.organizationId, input.interactionId, material.id, input.orchestratorId, reason, persisted.length],
    )
    persisted.push({ materialId: material.id, available: true, title: material.title, reason })
  }
  if (rejected.length > 0) {
    // Só ids — nunca o conteúdo da conversa.
    console.warn(JSON.stringify({ event: "assistant_support_materials_rejected", interactionId: input.interactionId, organizationId: input.organizationId, rejected }))
  }
  return persisted
}

/** Reabrir a conversa: materiais por interação, resolvidos com o acesso ATUAL do leitor. */
export async function loadAssistantSupportMaterials(
  db: Queryable,
  input: { organizationId: string; viewer: KnowledgeMaterialViewer; interactionIds: string[] },
): Promise<Map<string, AssistantSupportMaterialView[]>> {
  const byInteraction = new Map<string, AssistantSupportMaterialView[]>()
  const interactionIds = [...new Set(input.interactionIds.filter(isUuid))]
  if (interactionIds.length === 0) return byInteraction
  const stored = await db.query<{ interaction_id: string; knowledge_document_id: string; reason: string }>(
    `select interaction_id, knowledge_document_id, reason
     from assistant_interaction_support_materials
     where organization_id = $1 and interaction_id = any($2::uuid[])
     order by interaction_id, position`,
    [input.organizationId, interactionIds],
  )
  if (stored.rows.length === 0) return byInteraction
  const accessible = await resolveAccessibleKnowledgeMaterials(db, { organizationId: input.organizationId, viewer: input.viewer, materialIds: stored.rows.map((row) => row.knowledge_document_id) })
  for (const row of stored.rows) {
    const list = byInteraction.get(row.interaction_id) ?? []
    const material = accessible.get(row.knowledge_document_id)
    list.push(material ? { materialId: material.id, available: true, title: material.title, reason: row.reason } : { materialId: row.knowledge_document_id, available: false })
    byInteraction.set(row.interaction_id, list)
  }
  return byInteraction
}
