import type { FollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"
import type { AnalyticsSubject } from "../domain/analytics-subject.js"
import type { FollowUpFeed } from "../domain/view-models.js"
import type { AnalyticsReadRepository } from "./analytics-read-repository.js"
import { resolveSubject, type ViewerScope } from "./viewer-scope.js"

/**
 * Surface Acompanhamento sobre dados já persistidos — feedbacks publicados dos operadores do
 * sujeito e (pra gestores olhando a própria estrutura) os alertas endereçados a eles: outputs de
 * workflow, revisões humanas pendentes e escalonamentos. Mesmos objetos, sem tabela nova. Paginado por cursor (keyset),
 * como o Acompanhamento do colaborador.
 */
export type FollowUpFeedPageOptions = { limit: number; before: FollowUpCursor | null; unacknowledgedOnly: boolean }

export async function buildFollowUpFeed(repository: AnalyticsReadRepository, scope: ViewerScope, subject: AnalyticsSubject, options: FollowUpFeedPageOptions): Promise<FollowUpFeed> {
  const resolved = resolveSubject(scope, subject)
  const operatorIds = resolved.members.map((member) => member.id)
  const isOwnStructure = subject.kind !== "EMPLOYEE" && resolved.anchor?.id === scope.viewer.id
  return repository.loadFollowUpFeed({
    organizationId: scope.organizationId,
    viewerId: scope.viewer.id,
    operatorIds,
    includeViewerAlerts: isOwnStructure,
    unacknowledgedOnly: options.unacknowledgedOnly,
    limit: options.limit,
    before: options.before,
  })
}
