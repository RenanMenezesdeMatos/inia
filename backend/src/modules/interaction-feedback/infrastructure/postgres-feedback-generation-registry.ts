import type { Database } from "../../../infrastructure/database/pool.js"
import type { InteractionFeedbackStatus } from "../../investigation/domain/interaction-feedback.js"
import type { GenerationOutcomeSummary, GenerationRecord, GenerationRegistry, NewGeneration } from "../application/generate-interaction-feedback.js"

type Queryable = Pick<Database, "query">
type GenerationRow = { id: string; organization_id: string; generation_key: string; interaction_id: string; status: GenerationRecord["status"]; run_id: string | null; outcome: GenerationOutcomeSummary | null; attempts: number }
const toRecord = (row: GenerationRow): GenerationRecord => ({ id: row.id, organizationId: row.organization_id, generationKey: row.generation_key, interactionId: row.interaction_id, status: row.status, runId: row.run_id, outcome: row.outcome, attempts: row.attempts })

const INSERT_COLUMNS = `organization_id, generation_key, intent, contract_version, interaction_id, collaborator_id, workflow_id, workflow_version_id, node_id, enrollment_id, selection_source, selection_strategy, selection_rank`
const insertParams = (row: NewGeneration) => [row.organizationId, row.generationKey, row.intent.kind, row.contractVersion, row.interactionId, row.collaboratorId, row.intent.workflowId, row.intent.workflowVersionId, row.intent.nodeId, row.intent.enrollmentId, row.selection.source, row.selection.strategy, row.selection.rank]

/**
 * Registro de gerações (migration 082). A posse é decidida por UMA instrução (`insert … on conflict do update … where`):
 * duas execuções concorrentes da mesma intenção nunca possuem a mesma geração ao mesmo tempo — a segunda recebe
 * IN_PROGRESS (e o motor tenta de novo) ou COMPLETED (e reaproveita o resultado).
 */
export function createPostgresFeedbackGenerationRegistry(db: Queryable): GenerationRegistry {
  return {
    async claim(input, now, leaseSeconds) {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000)
      const owned = await db.query<GenerationRow>(
        `insert into interaction_feedback_generations as g (${INSERT_COLUMNS}, status, claimed_until, attempts, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING',$14,1,$15,$15)
         on conflict (organization_id, generation_key) do update
           set status = 'PENDING', claimed_until = $14, attempts = g.attempts + 1, last_error = null, updated_at = $15
           where g.status in ('RESERVED', 'FAILED') or (g.status = 'PENDING' and g.claimed_until < $15)
         returning g.*`,
        [...insertParams(input), leaseUntil, now],
      )
      if (owned.rows[0]) return { kind: "OWNED", generation: toRecord(owned.rows[0]) }
      const current = await db.query<GenerationRow>(`select * from interaction_feedback_generations where organization_id = $1 and generation_key = $2`, [input.organizationId, input.generationKey])
      const generation = toRecord(current.rows[0]!)
      return generation.status === "COMPLETED" ? { kind: "COMPLETED", generation } : { kind: "IN_PROGRESS", generation }
    },
    async findCompletedRun(organizationId, generationId) {
      const result = await db.query<{ id: string; status: InteractionFeedbackStatus; writer_invoked: boolean }>(
        `select id, status, writer_invoked from interaction_feedback_runs where organization_id = $1 and generation_id = $2 and completed_at is not null order by created_at limit 1`,
        [organizationId, generationId],
      )
      const run = result.rows[0]
      return run ? { runId: run.id, status: run.status, writerInvoked: run.writer_invoked } : null
    },
    async complete(organizationId, generationId, runId, outcome, now) {
      await db.query(
        `update interaction_feedback_generations set status = 'COMPLETED', run_id = $3, outcome = $4::jsonb, claimed_until = null, completed_at = $5, updated_at = $5
         where organization_id = $1 and id = $2 and status = 'PENDING'`,
        [organizationId, generationId, runId, JSON.stringify(outcome), now],
      )
    },
    async fail(organizationId, generationId, error, now) {
      await db.query(
        `update interaction_feedback_generations set status = 'FAILED', last_error = $3, claimed_until = null, updated_at = $4 where organization_id = $1 and id = $2 and status = 'PENDING'`,
        [organizationId, generationId, error.slice(0, 200), now],
      )
    },
    async listSelection(input) {
      const result = await db.query<{ interaction_id: string }>(
        `select interaction_id from interaction_feedback_generations where organization_id = $1 and workflow_id = $2 and node_id = $3 and enrollment_id = $4 order by selection_rank nulls last, created_at`,
        [input.organizationId, input.workflowId, input.nodeId, input.enrollmentId],
      )
      return result.rows.map((row) => row.interaction_id)
    },
    async selectedInteractionIds(input) {
      const result = await db.query<{ interaction_id: string }>(
        `select interaction_id from interaction_feedback_generations where organization_id = $1 and workflow_id = $2 and node_id = $3 and status <> 'FAILED'`,
        [input.organizationId, input.workflowId, input.nodeId],
      )
      return result.rows.map((row) => row.interaction_id)
    },
    async reserveSelection(rows, now) {
      for (const row of rows) {
        // FAILED de outra execução pode ser reescolhida; o que outra execução já possui/completou nunca é tomado.
        await db.query(
          `insert into interaction_feedback_generations as g (${INSERT_COLUMNS}, status, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'RESERVED',$14,$14)
           on conflict (organization_id, generation_key) do update
             set status = 'RESERVED', enrollment_id = excluded.enrollment_id, workflow_version_id = excluded.workflow_version_id, selection_strategy = excluded.selection_strategy, selection_rank = excluded.selection_rank, updated_at = $14
             where g.status = 'FAILED'`,
          [...insertParams(row), now],
        )
      }
    },
  }
}
