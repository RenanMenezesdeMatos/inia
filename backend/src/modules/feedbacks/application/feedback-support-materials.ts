import type { Database } from "../../../infrastructure/database/pool.js"
import { isUuid, resolveAccessibleKnowledgeMaterials, type KnowledgeMaterialViewer } from "../../knowledge/application/knowledge-material-access.js"
import { MAX_SUPPORT_MATERIALS_PER_FEEDBACK, SUPPORT_MATERIAL_REASON_MAX_LENGTH, type SupportMaterialRecommendation, type SupportMaterialRejection } from "../domain/support-material.js"

/**
 * Ponto ÚNICO do domínio onde uma recomendação de material vira relação persistida
 * (`feedback_support_materials`) e onde essa relação é lida de volta para qualquer superfície
 * (Acompanhamento do operador, feed da estrutura, detalhe do caso). Todos os caminhos que criam
 * Feedback gerado por IA (monitoria, indicador, resumo) passam por `persistFeedbackSupportMaterials`
 * — nenhum deles grava na tabela diretamente.
 */

export type SupportMaterialPersistenceWarning = {
  materialId: string
  code: "INVALID_ID" | "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT" | "DUPLICATE" | "LIMIT_EXCEEDED"
}

type Queryable = Pick<Database, "query">

/**
 * Persiste, dentro da MESMA transação do Feedback, só as recomendações que sobrevivem à validação
 * contra o banco — a segunda linha de defesa depois da checagem contra os candidatos da execução
 * (run-agent.ts). Aqui o LLM já não é a fonte: cada id precisa existir, ser da organização, estar
 * publicado, não excluído e acessível ao DESTINATÁRIO do Feedback pelo alcance da base. Referência
 * inválida é descartada com aviso estruturado; o Feedback continua. Cross-org é bloqueado pela
 * própria consulta (`organization_id`) — um id válido de outra organização nunca entra.
 */
export async function persistFeedbackSupportMaterials(
  client: Queryable,
  input: {
    organizationId: string
    feedbackId: string
    /** Destinatário do Feedback (operador) — o alcance do material é verificado contra ELE. */
    recipient: KnowledgeMaterialViewer
    recommendations: SupportMaterialRecommendation[] | undefined
  },
): Promise<{ persisted: SupportMaterialRecommendation[]; warnings: SupportMaterialPersistenceWarning[] }> {
  const warnings: SupportMaterialPersistenceWarning[] = []
  const persisted: SupportMaterialRecommendation[] = []
  const recommendations = input.recommendations ?? []
  if (recommendations.length === 0) return { persisted, warnings }

  const wellFormed = recommendations.filter((recommendation) => {
    if (isUuid(recommendation.materialId)) return true
    warnings.push({ materialId: recommendation.materialId, code: "INVALID_ID" })
    return false
  })

  const accessible = await resolveAccessibleKnowledgeMaterials(client, {
    organizationId: input.organizationId,
    viewer: input.recipient,
    materialIds: wellFormed.map((recommendation) => recommendation.materialId),
  })

  const seen = new Set<string>()
  for (const recommendation of wellFormed) {
    const material = accessible.get(recommendation.materialId)
    if (!material) {
      warnings.push({ materialId: recommendation.materialId, code: "MATERIAL_NOT_ACCESSIBLE_TO_RECIPIENT" })
      continue
    }
    if (seen.has(recommendation.materialId)) {
      warnings.push({ materialId: recommendation.materialId, code: "DUPLICATE" })
      continue
    }
    if (persisted.length >= MAX_SUPPORT_MATERIALS_PER_FEEDBACK) {
      warnings.push({ materialId: recommendation.materialId, code: "LIMIT_EXCEEDED" })
      continue
    }
    seen.add(recommendation.materialId)
    const reason = recommendation.reason.trim().slice(0, SUPPORT_MATERIAL_REASON_MAX_LENGTH)
    await client.query(
      `insert into feedback_support_materials(organization_id, feedback_id, knowledge_document_id, reason, position)
       values ($1,$2,$3,$4,$5)
       on conflict (feedback_id, knowledge_document_id) do nothing`,
      [input.organizationId, input.feedbackId, recommendation.materialId, reason, persisted.length],
    )
    // Título do material REAL (do banco), nunca o que veio do modelo.
    persisted.push({ materialId: material.id, title: material.title, reason })
  }

  if (warnings.length > 0) {
    // Observabilidade: só ids e códigos — nunca o texto do feedback ou do material.
    console.warn(JSON.stringify({ event: "feedback_support_materials_rejected", feedbackId: input.feedbackId, organizationId: input.organizationId, warnings }))
  }
  return { persisted, warnings }
}

/** O que o leitor recebe: material acessível (título real + motivo) ou marcador neutro de
 * indisponível — sem título nem motivo, para não vazar conteúdo de material fora do alcance. */
export type FeedbackSupportMaterialView =
  | { materialId: string; available: true; title: string; reason: string }
  | { materialId: string; available: false }

type StoredRow = { feedback_id: string; knowledge_document_id: string; reason: string; position: number }

/**
 * Lê as recomendações persistidas de N Feedbacks e resolve cada material com as regras de acesso
 * ATUAIS do leitor (Parte M do pedido): despublicado, excluído, fora da organização ou fora do
 * alcance do leitor → `available: false`, sem link e sem título. Feedback antigo sem linhas → `[]`.
 */
export async function loadFeedbackSupportMaterials(
  db: Queryable,
  input: { organizationId: string; viewer: KnowledgeMaterialViewer; feedbackIds: string[] },
): Promise<Map<string, FeedbackSupportMaterialView[]>> {
  const byFeedback = new Map<string, FeedbackSupportMaterialView[]>()
  const feedbackIds = [...new Set(input.feedbackIds.filter(isUuid))]
  if (feedbackIds.length === 0) return byFeedback

  const stored = await db.query<StoredRow>(
    `select feedback_id, knowledge_document_id, reason, position
     from feedback_support_materials
     where organization_id = $1 and feedback_id = any($2::uuid[])
     order by feedback_id, position`,
    [input.organizationId, feedbackIds],
  )
  if (stored.rows.length === 0) return byFeedback

  const accessible = await resolveAccessibleKnowledgeMaterials(db, {
    organizationId: input.organizationId,
    viewer: input.viewer,
    materialIds: stored.rows.map((row) => row.knowledge_document_id),
  })

  for (const row of stored.rows) {
    const list = byFeedback.get(row.feedback_id) ?? []
    const material = accessible.get(row.knowledge_document_id)
    list.push(
      material
        ? { materialId: material.id, available: true, title: material.title, reason: row.reason }
        : { materialId: row.knowledge_document_id, available: false },
    )
    byFeedback.set(row.feedback_id, list)
  }
  return byFeedback
}

/**
 * Relação Feedback ↔ Material na MESMA transação do Feedback, com o resultado (persistidos +
 * descartados na execução + descartados na persistência) anexado ao `context_snapshot` — o
 * histórico registra o que a IA pediu e o que o código aceitou, sem nunca virar link por conta
 * própria. Usada por create-monitoring-feedback.ts e create-indicator-feedback.ts. O destinatário entra como leitor comum
 * (nunca com bypass de Admin): o alcance da base decide.
 */
export async function persistSupportMaterialsWithSnapshot(
  client: { query: Database["query"] },
  input: { organizationId: string; feedbackId: string; operatorId: string; supportMaterials?: SupportMaterialRecommendation[] | undefined; supportMaterialsRejected?: SupportMaterialRejection[] | undefined },
): Promise<void> {
  const rejectedAtRun = input.supportMaterialsRejected ?? []
  if ((input.supportMaterials ?? []).length === 0 && rejectedAtRun.length === 0) return
  const { persisted, warnings } = await persistFeedbackSupportMaterials(client, {
    organizationId: input.organizationId,
    feedbackId: input.feedbackId,
    recipient: { personId: input.operatorId },
    recommendations: input.supportMaterials,
  })
  await client.query(
    `update feedbacks set context_snapshot = coalesce(context_snapshot, '{}'::jsonb) || $2::jsonb where id = $1`,
    [input.feedbackId, JSON.stringify({ supportMaterials: { persisted: persisted.map((item) => item.materialId), rejectedAtRun, rejectedAtPersistence: warnings } })],
  )
}
