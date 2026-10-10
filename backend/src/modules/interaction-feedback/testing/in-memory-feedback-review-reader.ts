import type { FeedbackReviewReader, QaGrantScope, QaPermission, ReviewQueueFilters, ReviewViewer } from "../application/feedback-review-reader.js"
import type { createInMemoryInteractionFeedbackStore } from "./in-memory-interaction-feedback-store.js"

/** Pessoa da hierarquia de teste (organização + reports_to + Grupo/Subgrupo atuais). */
export type TestPerson = { id: string; organizationId: string; name: string; jobTitle: string | null; reportsToId: string | null; team: { id: string; name: string } | null; subteamId?: string | null }
/** Atribuição ATIVA de papel de QA (V1.5.7). `permissions` ausente = as duas do QA_DE_FEEDBACK (ver + avaliar). */
export type TestGrant = QaGrantScope & { organizationId: string; personId: string; permissions?: readonly QaPermission[] }

/**
 * Leitor em memória com a MESMA semântica do Postgres: escopo = união das atribuições ATIVAS com a permissão pedida
 * (MY_STRUCTURE por reports_to, GROUP/SUBGROUP pela estrutura atual, ORGANIZATION), nunca pelo cargo; mesma organização; só itens HOLD_FOR_QA;
 * ninguém avalia o próprio feedback; mesmos filtros e ordenação (pendentes primeiro, mais recentes primeiro).
 */
export function createInMemoryFeedbackReviewReader(memory: ReturnType<typeof createInMemoryInteractionFeedbackStore>, people: TestPerson[], grants: TestGrant[] = []): FeedbackReviewReader {
  const grantsOf = (viewer: ReviewViewer, permission: QaPermission = "feedback_quality_review.view") => grants.filter((grant) => grant.organizationId === viewer.organizationId && grant.personId === viewer.personId && (grant.permissions ?? ["feedback_quality_review.view", "feedback_quality_review.decide"]).includes(permission))
  const descendants = (viewer: ReviewViewer) => {
    const found = new Set<string>()
    const queue = [viewer.personId]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const person of people) if (person.reportsToId === current && person.organizationId === viewer.organizationId && !found.has(person.id)) { found.add(person.id); queue.push(person.id) }
    }
    return found
  }
  const inScope = (viewer: ReviewViewer, collaborator: TestPerson, permission: QaPermission) => {
    const mine = grantsOf(viewer, permission)
    if (collaborator.id === viewer.personId || collaborator.organizationId !== viewer.organizationId) return false
    return mine.some((grant) =>
      grant.scopeType === "ORGANIZATION"
      || (grant.scopeType === "MY_STRUCTURE" && descendants(viewer).has(collaborator.id))
      || (grant.scopeType === "GROUP" && collaborator.team?.id === grant.teamId)
      || (grant.scopeType === "SUBGROUP" && (collaborator.subteamId ?? null) === grant.subteamId))
  }
  const scoped = (viewer: ReviewViewer, permission: QaPermission = "feedback_quality_review.view") =>
    [...memory.reviews.values()].flatMap((review) => {
      const run = memory.runs.get(review.runId)
      const collaborator = run ? people.find((person) => person.id === run.collaboratorId) : undefined
      const decision = memory.decisions.find((entry) => entry.itemReviewId === review.id)
      if (!run || !collaborator || !decision || decision.decision.disposition !== "HOLD_FOR_QA" || review.organizationId !== viewer.organizationId || !inScope(viewer, collaborator, permission)) return []
      const reviewer = review.reviewedBy ? people.find((person) => person.id === review.reviewedBy) : undefined
      return [{ review, context: { collaborator: { id: collaborator.id, name: collaborator.name, jobTitle: collaborator.jobTitle }, team: collaborator.team, occurredAt: run.occurredAt, createdAt: review.createdAt, reviewerName: reviewer?.name ?? null, selection: { decision: decision.decision, deliveredAt: decision.deliveredAt } } }]
    })
  const localDate = (date: Date) => date.toISOString().slice(0, 10)
  return {
    async grantsOf(viewer: ReviewViewer, permission: QaPermission) {
      return grantsOf(viewer, permission).map(({ scopeType, teamId, subteamId }) => ({ scopeType, teamId, subteamId }))
    },
    async listQueue(viewer: ReviewViewer, filters: ReviewQueueFilters) {
      const all = scoped(viewer)
      const matching = all.filter(({ review, context }) => (filters.status === "ALL" || review.reviewStatus === filters.status) && (!filters.search || context.collaborator.name.toLowerCase().includes(filters.search.toLowerCase())) && (!filters.collaboratorId || context.collaborator.id === filters.collaboratorId) && (!filters.teamId || context.team?.id === filters.teamId) && (!filters.section || review.section === filters.section) && (!filters.from || localDate(context.occurredAt ?? context.createdAt) >= filters.from) && (!filters.to || localDate(context.occurredAt ?? context.createdAt) <= filters.to))
      matching.sort((a, b) => Number(b.review.reviewStatus === "PENDING_REVIEW") - Number(a.review.reviewStatus === "PENDING_REVIEW") || (b.context.occurredAt ?? b.context.createdAt).getTime() - (a.context.occurredAt ?? a.context.createdAt).getTime() || a.review.slot.localeCompare(b.review.slot))
      const page = matching.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize)
      const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()]
      return {
        rows: page.map(({ review, context }) => ({ record: { id: review.id, reviewStatus: review.reviewStatus, section: review.section, findingKind: review.findingKind, wordingSource: review.wordingSource, interactionLabel: review.interactionLabel, reviewedAt: review.reviewedAt }, context })),
        total: matching.length,
        filterOptions: { collaborators: unique(all.map(({ context }) => ({ id: context.collaborator.id, name: context.collaborator.name }))), teams: unique(all.flatMap(({ context }) => (context.team ? [context.team] : []))) },
      }
    },
    async loadInScope(viewer: ReviewViewer, reviewId: string, permission: QaPermission = "feedback_quality_review.view") {
      const found = scoped(viewer, permission).find(({ review }) => review.id === reviewId)
      return found ? { record: structuredClone(found.review), context: found.context, knowledge: [] } : null
    },
  }
}
