export type CaseListItem = {
  id: string
  title: string
  summary: string
  status: string
  priority: string
  indicatorCode: string
  indicatorValue: string
  indicatorTarget: string
  rootCause: string | null
  confidence: number | null
  operator: { id: string; name: string }
  team: { id: string; name: string }
  updatedAt: string
}

export type CaseDetail = CaseListItem & {
  evidences: Array<{ id: string; type: string; title: string; description: string; sourceType: string; sourceId: string; occurredAt: string }>
  recommendations: Array<{ id: string; actionType: string; description: string; expectedImpact: string; dueAt: string | null }>
  feedbacks: Array<{ id: string; status: string; impactedIndicator: string; evidenceFound: string; observedBehavior: string; relatedProcedure: string; recommendation: string; suggestedApproach: string | null }>
}

/** Onde o caso "mora" para a autorização: o colaborador e o Grupo/Subgrupo dele. */
export type CaseOwnership = { operatorId: string; teamId: string | null; subteamId: string | null }

/**
 * Recorte VISÍVEL de casos para quem pede — resolvido no servidor a partir da sessão (ver case-visibility.ts), nunca do
 * browser: colaboradores visíveis (estrutura ∪ `indicators.view`) e Grupos/Subgrupos de `agents.manage`.
 */
export type CaseVisibility = {
  organizationId: string
  operatorIds: readonly string[]
  organizationWide: boolean
  teamIds: readonly string[]
  subteamIds: readonly string[]
}

export interface CaseRepository {
  list(visibility: CaseVisibility, limit: number): Promise<CaseListItem[]>
  /** Dono do caso NA organização (null = não existe nela) — consultado antes de carregar o detalhe. */
  ownership(organizationId: string, id: string): Promise<CaseOwnership | null>
  findById(organizationId: string, id: string): Promise<CaseDetail | null>
}
