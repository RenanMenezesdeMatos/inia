import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { validatePublishableFeedback } from "../domain/feedback.js"

type FeedbackRow = {
  id: string; case_id: string; organization_id: string; status: string
  impacted_indicator: string; evidence_found: string; observed_behavior: string
  related_procedure: string; recommendation: string; suggested_approach: string | null
}

export class PublishFeedback {
  constructor(private readonly db: Database) {}

  /** `organizationId` (pedido HTTP) restringe à organização da sessão; chamadas internas do motor já vêm da própria organização. */
  async execute(id: string, scope: { organizationId?: string } = {}) {
    const client = await this.db.connect()
    try {
      await client.query("begin")
      const result = await client.query<FeedbackRow>("select * from feedbacks where id = $1 and ($2::uuid is null or organization_id = $2::uuid) for update", [id, scope.organizationId ?? null])
      const feedback = result.rows[0]
      if (!feedback) throw new DomainError("Feedback não encontrado.", "FEEDBACK_NOT_FOUND", 404)
      if (feedback.status !== "APPROVED") throw new DomainError("Somente feedback aprovado pode ser publicado.", "FEEDBACK_NOT_APPROVED", 409)

      validatePublishableFeedback({
        impactedIndicator: feedback.impacted_indicator,
        evidenceFound: feedback.evidence_found,
        observedBehavior: feedback.observed_behavior,
        relatedProcedure: feedback.related_procedure,
        recommendation: feedback.recommendation,
        ...(feedback.suggested_approach ? { suggestedApproach: feedback.suggested_approach } : {}),
      })

      const evidenceCount = await client.query<{ count: string }>("select count(*) count from evidences where case_id = $1", [feedback.case_id])
      if (Number(evidenceCount.rows[0]?.count ?? 0) === 0) throw new DomainError("O caso não possui evidência verificável.", "CASE_EVIDENCE_REQUIRED", 422)

      await client.query("update feedbacks set status = 'PUBLISHED', published_at = now(), updated_at = now(), version = version + 1 where id = $1", [id])
      await client.query("insert into case_timeline_events (organization_id, case_id, event_type, payload) values ($1, $2, 'FEEDBACK_PUBLISHED', $3)", [feedback.organization_id, feedback.case_id, { feedbackId: id }])
      await client.query("commit")
      return { id, status: "PUBLISHED" as const }
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }
}
