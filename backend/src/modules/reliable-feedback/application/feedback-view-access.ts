import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveAccessibleKnowledgeMaterials, type KnowledgeMaterialViewer } from "../../knowledge/application/knowledge-material-access.js"
import { buildKnowledgeMaterialHref } from "../../knowledge/domain/material-href.js"
import { withCurrentBestPractices } from "../../best-practices/application/feedback-section.js"
import { feedbackViewDocumentIds, isFeedbackView, withMaterialAccess, type FeedbackView } from "../domain/feedback-view.js"

/**
 * FEEDBACK POR FLAG V2 — o view model publicado (snapshot) resolvido PARA QUEM LÊ: uma consulta de acesso para todos os
 * feedbacks da página; material fora do alcance do leitor fica sem link (nunca um link quebrado). Valor que não é um view
 * model V2 (feedback anterior) → null: a tela usa o texto publicado de sempre.
 */
export async function resolveFeedbackViewsForViewer(db: Pick<Database, "query">, input: { organizationId: string; viewer: KnowledgeMaterialViewer; views: readonly unknown[] }): Promise<(FeedbackView | null)[]> {
  const views = input.views.map((value) => (isFeedbackView(value) ? value : null))
  const materialIds = [...new Set(views.flatMap((view) => (view ? feedbackViewDocumentIds(view) : [])))]
  const accessible = materialIds.length > 0 ? await resolveAccessibleKnowledgeMaterials(db, { organizationId: input.organizationId, viewer: input.viewer, materialIds }) : new Map()
  const allowed = new Set(accessible.keys())
  // Boas práticas: item cujo padrão deixou de estar disponível (desativado, rejeitado, evidência enfraquecida) some na leitura.
  return withCurrentBestPractices(db, input.organizationId, views.map((view) => (view ? withMaterialAccess(view, allowed, buildKnowledgeMaterialHref) : null)))
}
