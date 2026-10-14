import type { AnalyticsSubject } from "../domain/analytics-subject.js"
import { longPeriodLabel } from "../domain/reference-period.js"
import { buildIndicatorViewCapabilities } from "../domain/view-capabilities.js"
import type { AnalyticsContext } from "../domain/view-models.js"
import type { AnalyticsReadRepository } from "./analytics-read-repository.js"
import { hasAccessGrant, resolveDefaultSubject, resolveSubject, visibleOperators, type ViewerScope } from "./viewer-scope.js"

/**
 * Primeiro carregamento da área: quem é o viewer, seu sujeito padrão, o que pode ver e quais
 * competências têm dado oficial no escopo dele. Aceita um sujeito explícito (drill-down) pra
 * devolver as capabilities certas daquele sujeito — sempre validado contra o escopo.
 */
export async function buildAnalyticsContext(repository: AnalyticsReadRepository, scope: ViewerScope, subject: AnalyticsSubject | null, lastClosedPeriod: string): Promise<AnalyticsContext> {
  const defaultSubject = resolveDefaultSubject(scope)
  const effective = subject ?? defaultSubject?.subject ?? null
  // Sem sujeito nenhum (quem está fora da hierarquia, ex.: o Administrador geral do setup), as competências vêm de tudo o
  // que o escopo de acesso dele alcança — é o que a ficha de quem ele visita oferece no seletor. Quem tem sujeito padrão
  // continua com as competências da própria estrutura.
  const members = effective ? resolveSubject(scope, effective).members : visibleOperators(scope)
  // Guard central do fechamento oficial: o seletor de competência só conhece meses FECHADOS
  // (<= último fechamento possível no fuso da organização) — o mês corrente nunca aparece,
  // exista ou não linha no banco (official-closure-policy.ts).
  const [periods, pendingActionCount, calendarAccess] = await Promise.all([
    repository.loadAvailablePeriods(scope.organizationId, members.map((member) => member.id), lastClosedPeriod),
    repository.countPendingActions(scope.organizationId, scope.viewer.id),
    repository.loadAccessVisibility(scope.organizationId, scope.accountId, "calendar.manage"),
  ])
  const current = lastClosedPeriod
  const availablePeriods = (periods.includes(current) ? periods : [current, ...periods]).map((period) => ({ period, label: longPeriodLabel(period) }))
  return {
    viewer: { personId: scope.viewer.id, role: scope.role, name: scope.viewer.name },
    defaultSubject,
    capabilities: buildIndicatorViewCapabilities(scope.role, effective?.kind ?? "EMPLOYEE", { hasPendingActions: pendingActionCount > 0, canManageCalendar: hasAccessGrant(calendarAccess) }),
    pendingActionCount,
    availablePeriods,
    // Competência inicial = a mais recente COM dado (senão o último mês fechado, que pode estar
    // vazio) — nunca o mês corrente.
    currentPeriod: periods[0] ?? current,
  }
}
