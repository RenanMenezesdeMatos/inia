import type { AnalyticsSubject } from "../domain/analytics-subject.js"
import type { FollowUpFeed } from "../domain/view-models.js"
import type { AnalyticsReadRepository } from "./analytics-read-repository.js"
import { resolveSubject, type ViewerScope } from "./viewer-scope.js"

/**
 * Surface Acompanhamento sobre dados já persistidos — feedbacks publicados dos operadores do
 * sujeito e (pra gestores olhando a própria estrutura) os alertas endereçados a eles: outputs de
 * workflow, revisões humanas pendentes e escalonamentos. Mesmos objetos, sem tabela nova.
 */
export async function buildFollowUpFeed(repository: AnalyticsReadRepository, scope: ViewerScope, subject: AnalyticsSubject, page: number, pageSize: number, unacknowledgedOnly = false): Promise<FollowUpFeed> {
  const resolved = resolveSubject(scope, subject)
  const operatorIds = resolved.members.map((member) => member.id)
  const isOwnStructure = subject.kind !== "EMPLOYEE" && resolved.anchor?.id === scope.viewer.id
  const { items, total } = await repository.loadFollowUpFeed({
    organizationId: scope.organizationId,
    viewerId: scope.viewer.id,
    operatorIds,
    includeViewerAlerts: isOwnStructure,
    unacknowledgedOnly,
    page,
    pageSize,
  })
  return { items, total, page, pageSize }
}
